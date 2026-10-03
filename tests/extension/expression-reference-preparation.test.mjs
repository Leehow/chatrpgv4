import assert from 'node:assert/strict';import {test} from 'node:test';
import {createExpressionPreparation,expressionContext} from '../../extensions/table/expression-reference.ts';
const card={name:'Clarification',kind:'interaction',activation_question:'Is the targeted person responding to the current request?',applies:'A calm clarification.',pattern:'Confirm what is known.',examples:[{context:'Time unknown.',reply:'Before dusk, exact time unknown.'}]};
const capsule=()=>({mods:{active:[{id:'x',version:'1.0.0'}],expression_reference:{enabled:true,revision:'r1',play_language:'zh-Hans'}},turn:{player_text:'Please clarify.'},present:[{name:'Witness',mood:'calm'}],voices:[{name:'Witness',mask:'Careful with uncertain memory.'}],where:{name:'office'},known:{investigator:{name:'Player'}},recent:[]});
const binding=t=>({campaign:'c',worldline:'main',loop:0,turn:t,source_revision:'s1'});
const answer=batch=>({batchId:batch.id,status:'complete',coverage:{required:[],answered:[],unknown:[]},issues:[],answers:Object.fromEntries(batch.questions.map(q=>[q.key,{status:'answered',type:'noul',noul:q.key.startsWith('conflict_')?.02:.95}]))});
const tick=()=>new Promise(r=>setImmediate(r));
test('the first request waits for its existing selection and a changed snapshot cannot renew the wait',async()=>{
 let finish,calls=0;const refs=createExpressionPreparation({firstWaitMs:30,read:async()=>({enabled:true,revision:'r1',play_language:'zh-Hans',packages:[{id:'x',version:'1.0.0',digest:'d',cards:[card]}]}),decision:()=>({decide:async batch=>{calls++;return await new Promise(r=>{finish=()=>r(answer(batch))})}}),record:()=>{}});
 const c=capsule(),b=binding(1),signal=new AbortController().signal;refs.observe(c,b,signal);await tick();
 let released=false;const pending=refs.waitForFirst(c,b,signal).then(()=>{released=true});await tick();assert.equal(released,false,'the first writer has not outrun an applicable reference');finish();await pending;assert.ok(refs.project(c,b));assert.equal(calls,1);
 const changed={...b,source_revision:'s2'};refs.observe(c,changed,signal);await tick();
 const race=await Promise.race([refs.waitForFirst(c,changed,signal).then(()=>true),tick().then(()=>false)]);assert.equal(race,true,'a second snapshot must not add another wait');finish();await tick();refs.clear();
});
test('first-request expiry and cancellation release a non-cooperative selector without publishing it',async()=>{
 const make=()=>createExpressionPreparation({firstWaitMs:20,read:async()=>({enabled:true,revision:'r1',play_language:'zh-Hans',packages:[{id:'x',version:'1.0.0',digest:'d',cards:[card]}]}),decision:()=>({decide:async()=>await new Promise(()=>{})}),record:()=>{}});
 const c=capsule(),b=binding(1),refs=make(),input=new AbortController();refs.observe(c,b,input.signal);await tick();await refs.waitForFirst(c,b,input.signal);assert.equal(refs.project(c,b),undefined);refs.clear();
 const cancelled=make(),control=new AbortController();cancelled.observe(c,b,control.signal);await tick();const waiting=cancelled.waitForFirst(c,b,control.signal);control.abort();await waiting;assert.equal(cancelled.project(c,b),undefined);cancelled.clear();
});
test('an obsolete provisional snapshot cannot spend the first exact-request selection window',async()=>{
 let finish;const refs=createExpressionPreparation({firstWaitMs:20,read:async()=>({enabled:true,revision:'r1',play_language:'zh-Hans',packages:[{id:'x',version:'1.0.0',digest:'d',cards:[card]}]}),decision:()=>({decide:async batch=>await new Promise(r=>{finish=()=>r(answer(batch))})}),record:()=>{}});
 const c=capsule(),b=binding(1),signal=new AbortController().signal;refs.observe(c,b,signal);await tick();finish();await tick();await new Promise(r=>setTimeout(r,25));
 const changed={...b,source_revision:'s2'};refs.observe(c,changed,signal);await tick();let released=false;const waiting=refs.waitForFirst(c,changed,signal).then(()=>{released=true});await tick();assert.equal(released,false,'the first exact writing frame still has its bounded window');finish();await waiting;assert.ok(refs.project(c,changed));refs.clear();
});
test('selection reads materialized committed exchanges and preserves established speaker context',()=>{
 const c=capsule();c.present[0].called='Doctor';c.present[0].knowledge=['Saw the door open.'];c.present[0].history={last_spoke_turn:1};
 c.recent=[{turn:1,keeper:'A truncated prefix.'}];c.expression_exchange={quotes:[{turn:1,role:'keeper',text:'x'.repeat(240)+' Who sent you?',verified:true,truncated:false}]};
 const actual=expressionContext(c);assert.ok(actual.recent[0].text.endsWith('Who sent you?'));assert.equal(actual.people[0].called,'Doctor');assert.equal(actual.people[0].last_spoke_turn,1);assert.deepEqual(actual.people[0].knowledge,c.present[0].knowledge);
});
test('projection is immediately empty while external selection waits; ready result retains source voice',async()=>{
 let finish,calls=0;const refs=createExpressionPreparation({read:async()=>({enabled:true,revision:'r1',play_language:'zh-Hans',packages:[{id:'x',version:'1.0.0',digest:'d',cards:[card]}]}),decision:()=>({decide:async batch=>{calls++;assert.equal(batch.state.context.people[0].speech_card.mask,'Careful with uncertain memory.');return await new Promise(r=>{finish=()=>r(answer(batch));});}}),record:()=>{}});
 const c=capsule(),b=binding(1),signal=new AbortController().signal;refs.observe(c,b,signal);assert.equal(refs.project(c,b),undefined);await tick();finish();await tick();
 const ready=refs.project(c,b);assert.ok(ready.content.includes(card.reply??card.examples[0].reply));assert.ok(!ready.content.includes('activation_question'));assert.ok(!ready.content.includes('digest'));refs.observe(c,b,signal);assert.equal(calls,1);
 refs.observe(c,{...b,memory_coverage:{committed:1}},signal);assert.equal(calls,1,'unread bookkeeping changes do not repeat an identical decision');assert.ok(refs.project(c,{...b,memory_coverage:{committed:1}}));
 assert.equal(refs.project(c,binding(2)),undefined);refs.clear();
});
test('pre-cancelled input starts no work; cancellation and source change cannot reuse prepared advice',async()=>{
 let calls=0;const ctl=new AbortController(),refs=createExpressionPreparation({read:async()=>({enabled:true,revision:'r1',play_language:'zh-Hans',packages:[{id:'x',version:'1.0.0',digest:'d',cards:[card]}]}),decision:()=>({decide:async batch=>{calls++;return answer(batch)}}),record:()=>{}});
 ctl.abort();refs.observe(capsule(),binding(1),ctl.signal);await tick();assert.equal(calls,0);
 const fresh=new AbortController(),c=capsule(),b=binding(1);refs.observe(c,b,fresh.signal);await tick();assert.ok(refs.project(c,b));
 assert.equal(refs.project(c,{...b,source_revision:'s2'}),undefined);fresh.abort();assert.equal(refs.project(c,b),undefined);refs.clear();
});
test('a failed directory read is retried on a new snapshot, never retained as an immutable catalog',async()=>{
 let reads=0;const refs=createExpressionPreparation({read:async()=>{if(++reads===1)throw Error('transient');return{enabled:true,revision:'r1',play_language:'zh-Hans',packages:[{id:'x',version:'1.0.0',digest:'d',cards:[card]}]}},decision:()=>({decide:async batch=>answer(batch)}),record:()=>{}});
 const c=capsule();refs.observe(c,binding(1),new AbortController().signal);await tick();assert.equal(refs.project(c,binding(1)),undefined);
 refs.observe(c,binding(2),new AbortController().signal);await tick();assert.ok(refs.project(c,binding(2)));assert.equal(reads,2);refs.clear();
});
test('a catalog changed after capsule publication is refused before any decision',async()=>{
 let calls=0;const refs=createExpressionPreparation({read:async()=>({enabled:true,revision:'new',play_language:'zh-Hans',packages:[]}),decision:()=>({decide:async()=>{calls++;throw Error('must not run')}}),record:()=>{}});
 const c=capsule(),b=binding(1);refs.observe(c,b,new AbortController().signal);await tick();assert.equal(calls,0);assert.equal(refs.project(c,b),undefined);refs.clear();
});
