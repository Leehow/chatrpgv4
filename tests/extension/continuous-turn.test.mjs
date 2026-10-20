import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHybridEngine} from '../../runtime/jev/hybrid-engine.ts';
import {ContinuousTurn} from '../../runtime/jev/continuous-turn.ts';
import {packDecisionBatch} from '../../runtime/jev/question-packing.ts';

function host(decision,options={}){
    const bus=new Map();
    const engine=createHybridEngine({env:{},decision,record:()=>{}});
    engine.extension({events:{on:(name,fn)=>bus.set(name,fn),emit:()=>{}},on:()=>{}});
    bus.get('coc:kernel-bridge')({campaign:'c1',call:options.call??(async()=>({}))});
    bus.get('coc:operation-dispatcher')({dispatch:options.dispatch??(async()=>({status:'succeeded',result:{},receipts:[]}))});
    return engine.runDriver.prepare({runId:'run-1',inputRevision:'input-1',rawInput:'I ask the landlord what he saw.',session:options.session});
}
const view={pendingProposals:[],delivery:'none',policyState:null,steps:0};

test('configured Jev gets a native decision opportunity before generative planning',()=>{
    const {policy,ports}=host({decide:async()=>{throw Error('not called by policy');}});
    const first=policy.next(view);
    assert.equal(first.kind,'operate');
    assert.equal(first.proposals[0].operation,'continuous_prepare');
    assert.equal(typeof ports.decision.decide,'function');
});

const capsule={_context:{campaign:'c1',turn:1,worldline:'main',loop:0,world_revision:'w1'},where:{scene:'office'},present:[]};
const moveOptions={candidates:[{effect:{kind:'move',to:'library'},description:{display_name:'Central Library',travel_minutes:10,unlock_when:{met:true}}}]};
function choose(confidence=.99){
    return{decide:async batch=>({batchId:batch.id,status:'complete',answers:Object.fromEntries(batch.questions.map(question=>[question.key,
        {status:'answered',type:'choice',choice:'now',confidence,probabilities:{now:.99,later:.005,unknown:.005}}])),
        coverage:{required:batch.questions.map(question=>question.key),answered:batch.questions.map(question=>question.key),unknown:[]},issues:[]})};
}
const invocation={stepId:'s1',signal:new AbortController().signal};

for(const active of [true,false])test('a location provider owns travel before feature changes; provider active='+active,async()=>{
 let judgments=0,writes=0;const records=[];
 const current={...capsule,_context:{...capsule._context,source_revision:'s1'},...(active?{mods:{location_context:{mod:'locations-under-test',version:'1.0.0'}}}:{})};
 const turn=new ContinuousTurn({run:'r',inputRevision:'i',campaign:'c1',playerText:'I push the rear door open and return to Central Library.',session:{},current:()=>true,packet:true,
  call:async method=>method==='table.apply.options'?moveOptions:current,record:row=>records.push(row),dispatch:async()=>{writes++;return{status:'succeeded'};},
  decision:{decide:async batch=>{judgments++;return{batchId:batch.id,status:'complete',answers:Object.fromEntries(batch.questions.map(q=>[q.key,{status:'answered',type:'noul',noul:q.key.startsWith('consent_')?.99:.01}])),issues:[],coverage:{required:batch.questions.map(q=>q.key),answered:batch.questions.map(q=>q.key),unknown:[]}};}}});
 await turn.prepare(invocation.signal);await turn.decide(invocation.signal);
 assert.equal(turn.prescreen.choices.length,1,'registered destinations stay available to the Keeper');
 if(active){
  assert.equal(judgments,0,'the provider needs no competing automatic travel decision');
  assert.deepEqual(turn.selected,[]);assert.equal((await turn.execute(invocation.signal)).status,'refused');assert.equal(writes,0);
  assert.ok(turn.materials(current)?.candidates.length,'reuse source material without consuming the selected action');
  assert.ok(records.some(row=>row.reason==='location_provider_owns_movement'));
 }else{assert.equal(judgments,1);assert.equal(turn.selected.length,1,'the existing legacy fast path retains its authority');}
});

test('packet mode exposes a route slot without judging or executing an incomplete journey',async()=>{
 let judgments=0,writes=0;
 const turn=new ContinuousTurn({run:'r',inputRevision:'i',campaign:'c1',playerText:'I go to Central Library.',session:{},current:()=>true,packet:true,
  call:async method=>method==='table.apply.options'?{candidates:[{...moveOptions.candidates[0],description:{...moveOptions.candidates[0].description,requires_via:true}}]}:{...capsule,_context:{...capsule._context,source_revision:'s1'}},
  record:()=>{},dispatch:async()=>{writes++;},decision:{decide:async()=>{judgments++;throw Error('An incomplete route cannot be judged');}}});
 await turn.prepare(invocation.signal);
 assert.equal(turn.decided,true);assert.equal(turn.batch,undefined);
 assert.deepEqual(turn.prescreen.choices,[{effects:[{kind:'move',to:'library'}],requires_via:true}]);
 assert.equal((await turn.execute(invocation.signal)).status,'refused');
 assert.equal(judgments,0);assert.equal(writes,0);
});

for(const available of [true,false])test('packet mode defers untimed movement to one Keeper choice; registry available='+available,async()=>{
 let judgments=0,writes=0,reads=0;
 const rows=[{handle:'local_travel',min:5,max:30,default:20},{handle:'long_travel',min:60,max:240,default:120}];
 const turn=new ContinuousTurn({run:'r',inputRevision:'i',campaign:'c1',playerText:'I go to the Annex.',session:{},current:()=>true,packet:true,
  call:async method=>method==='table.apply.options'?{candidates:[{effect:{kind:'move',to:'Annex'},description:{display_name:'Annex',unlock_when:{met:true}}}]}:{...capsule,_context:{...capsule._context,source_revision:'s1'}},
  timeBands:async()=>{reads++;return available?rows:[];},record:()=>{},dispatch:async()=>{writes++;},decision:{decide:async()=>{judgments++;throw Error('An untimed journey cannot execute automatically');}}});
 await turn.prepare(invocation.signal);assert.equal(turn.decided,true);assert.equal(turn.batch,undefined);assert.deepEqual(turn.selected,[]);
 assert.deepEqual(turn.prescreen.choices,available?[{effects:[{kind:'move',to:'Annex'}],travel_bands:['adjacent','local_travel','long_travel']}]:[]);
 assert.equal((await turn.execute(invocation.signal)).status,'refused');assert.equal(reads,1);assert.equal(judgments,0);assert.equal(writes,0);
});

test('the native ports decide and execute a fully bound move once, then infer',async()=>{
    const calls=[],writes=[],session={extensionRunner:{}};
    const {policy,ports}=host(choose(),{call:async method=>{calls.push(method);return method==='table.apply.options'?moveOptions:capsule;},
        session,dispatch:async(proposal,context)=>{assert.strictEqual(context.session,session,'the canonical dispatcher needs the real current AgentSession');await context.validateCurrent(proposal);writes.push(proposal);return{status:'succeeded',result:{receipts:['move']}};}});
    await ports.operations.execute(policy.next(view).proposals[0],invocation);
    assert.equal(policy.next(view).kind,'decide');
    await ports.decision.decide(invocation);
    assert.equal(policy.next(view).proposals[0].operation,'continuous_apply');
    await ports.operations.execute(policy.next(view).proposals[0],invocation);
    assert.equal(policy.next(view).kind,'infer');assert.equal(policy.next(view).kind,'infer');
    assert.equal(writes.length,1);assert.deepEqual(writes[0].args,{effects:[{kind:'move',to:'library'}]});
    assert.equal(calls.filter(method=>method==='table.apply.options').length,1);
});

test('low confidence and changed state execute no host write',async()=>{
    for(const stale of [false,true]){
        let changed=false,writes=0;
        const {policy,ports}=host(choose(stale?.99:.6),{call:async method=>method==='table.apply.options'?moveOptions:
            {...capsule,_context:{...capsule._context,world_revision:changed?'w2':'w1'}},
            dispatch:async(proposal,context)=>{await context.validateCurrent(proposal);writes++;return{status:'succeeded'};}});
        await ports.operations.execute(policy.next(view).proposals[0],invocation);
        await ports.decision.decide(invocation);
        if(stale){changed=true;await ports.operations.execute(policy.next(view).proposals[0],invocation);}
        assert.equal(writes,0);assert.equal(policy.next(view).kind,'infer');
    }
});

test('unconfigured Jev keeps the same Keeper without adding another model judge',()=>{
    const {policy}=host(null);
    assert.equal(policy.next(view).kind,'infer');
});

test('large independent source options remain intact in bounded parallel Jev batches',async()=>{
 const seen=[],rows=[];
 const candidates=Array.from({length:8},(_,index)=>({effect:{kind:'move',to:`place-${index}`},
  description:{display_name:`Place ${index}`,travel_minutes:10,material:`Access condition ${index}. `+'x'.repeat(6000),unlock_when:{met:true}}}));
 const turn=new ContinuousTurn({run:'r',inputRevision:'i',campaign:'c1',playerText:'I go to Place 7.',session:{},current:()=>true,
  call:async method=>method==='table.apply.options'?{candidates}:capsule,record:row=>rows.push(row),dispatch:async()=>{throw Error('No write in packing test');},
  decision:{decide:async batch=>{packDecisionBatch(batch);seen.push(batch);return{...await choose().decide(batch),answers:Object.fromEntries(batch.questions.map(q=>[q.key,
   {status:'answered',type:'choice',choice:q.key==='need_7'?'now':'later',confidence:1,probabilities:q.key==='need_7'?{now:1,later:0,unknown:0}:{now:0,later:1,unknown:0}}]))};}}});
 const signal=new AbortController().signal;await turn.prepare(signal);assert.equal(turn.decided,false,JSON.stringify(rows));await turn.decide(signal);
 assert.ok(seen.length>1);assert.equal(seen.flatMap(batch=>batch.state.candidates).length,8);
 assert.ok(seen.every(batch=>batch.state.candidates.every(candidate=>candidate.conditions.material.length>6000)));
 assert.deepEqual(turn.selected.map(candidate=>candidate.bound.to),['place-7']);
});

test('uncertain choices hand existing destination material to the same Keeper and retire it on revision change',async()=>{
 let current={...capsule,_context:{...capsule._context,source_revision:'s1'}};
 const destination={names:['Municipal Registry'],summary:'RETAINED_DESTINATION_SOURCE',where:['State Street'],people:['Records clerk']};
 const {policy,ports}=host(choose(.6),{call:async method=>method==='table.apply.options'
  ?{candidates:[{...moveOptions.candidates[0],description:{...moveOptions.candidates[0].description,destination,travel_minutes:10}}]}:current});
 await ports.operations.execute(policy.next(view).proposals[0],invocation);await ports.decision.decide(invocation);
 const packet=async()=>{const messages=await ports.projection.project({stepId:'projection',signal:invocation.signal});return JSON.parse(messages.find(message=>message.customType==='coc-clerk').content);};
 const same=await packet();assert.deepEqual(same.prepared_operations.candidates[0].conditions.destination,destination);
 assert.equal(same.prepared_operations.candidates[0].conditions.travel_minutes,10);
 assert.match(same.prepared_operations.authority,/not authorization/);
 current={...current,_context:{...current._context,source_revision:'s2'}};assert.equal((await packet()).prepared_operations,undefined);
 current={...current,_context:{...current._context,source_revision:'s1',world_revision:'w2'}};assert.equal((await packet()).prepared_operations,undefined);
});

test('packet material exposes only the same open movement slots as the executable packet',async()=>{
 const current={...capsule,_context:{...capsule._context,source_revision:'s1'}};
 const turn=new ContinuousTurn({run:'r',inputRevision:'i',campaign:'c1',playerText:'I go to the library.',session:{},current:()=>true,packet:true,
  call:async method=>method==='table.apply.options'?moveOptions:current,record:()=>{},dispatch:async()=>{throw Error('No write');},
  decision:choose()});
 await turn.prepare(invocation.signal);await turn.decide(invocation.signal);
 const material=turn.materials(current);assert.ok(material?.candidates.length);
 for(const candidate of material.candidates){
  const choice=turn.prescreen.choices.find(row=>row.effects[0].to===candidate.operation.effects[0].to);
  assert.deepEqual(candidate.parameters.map(row=>row.name),[
   ...(choice.requires_via===true?['via']:[]),...(choice.travel_bands?['travel_band']:[])]);
 }
});

test('an oversized option defers its conditions explicitly and cannot authorize a different move',async()=>{
 const current={...capsule,_context:{...capsule._context,source_revision:'s1'}},seen=[];
 const turn=new ContinuousTurn({run:'r',inputRevision:'i',campaign:'c1',playerText:'I go to the library.',session:{},current:()=>true,
  call:async method=>method==='table.apply.options'?{candidates:[...moveOptions.candidates,
   {effect:{kind:'move',to:'large-place'},description:{display_name:'Large place',travel_minutes:10,destination:{summary:'x'.repeat(40000)}}}]}:current,
  record:row=>seen.push(row),dispatch:async()=>{throw Error('No write in coverage test');},decision:choose()});
 const signal=new AbortController().signal;await turn.prepare(signal);await turn.decide(signal);
 assert.deepEqual(turn.selected,[],'an unassessed destination cannot disappear from conflict coverage');
 const material=turn.materials(current);assert.ok(Buffer.byteLength(JSON.stringify(material))<=24*1024);
 assert.equal(material.coverage.partial,1);assert.match(material.candidates.find(row=>row.operation.effects[0].to==='large-place').material_coverage,/omitted/);
 assert.ok(seen.some(row=>row.event==='candidate_deferred'));
});

test('the same Keeper may submit a bounded private record with its public text',async()=>{
    const {ports}=host(null);
    const messages=await ports.projection.project({stepId:'step-1',signal:new AbortController().signal});
    const guidance=messages.filter(message=>message.customType==='coc-host').map(message=>message.content).join(' ');
    assert.match(guidance,/private record/);
    assert.doesNotMatch(guidance,/Do not place outstanding effects or event parameters in a final response/);
});
