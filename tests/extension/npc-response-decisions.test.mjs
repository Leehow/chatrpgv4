/** Observable advisory decisions through the shared DecisionPort; provider responses are the only fake. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {evaluateNpcResponses} from '../../runtime/jev/npc-responses.ts';

const snapshot=name=>({name,scope:{worldline:'main',loop:0},view_revision:`view-${name}`,personality:{description:'Practical and remembers promises.'},
 input:{turn:1,player_input:'Thank you, I am leaving now.'},responses:[{intent:'Acknowledge the departure and return to work.',when:'The visitor has chosen to leave.'}],
 authored_knowledge:[],knowledge_reports:[],relationships:[],commitments:[],recent_speech:[]});
function answer(batch){
 const answers=Object.fromEntries(batch.questions.map(q=>[q.key,{status:'answered',type:q.type,
   ...(q.type==='choice'?{choice:q.key==='choose'?'response:1':'supported'}:{score:3})}]));
 return {batchId:batch.id,status:'complete',answers,coverage:{required:batch.questions.map(q=>q.key),answered:batch.questions.map(q=>q.key),unknown:[]},issues:[],elapsedMs:1,attempts:1};
}
test('independent NPC requests start together, preserve separate perspectives and publish fast peers',async()=>{
 const releases=new Map(),calls=[],seen=[];
 const decision={decide:async batch=>{calls.push(batch);return new Promise(resolve=>releases.set(batch.state.npc.name,()=>resolve(answer(batch))));}};
 const snapshots=['Anna','Bela','Cora'].map(snapshot);
 const pending=evaluateNpcResponses({campaign:'test',snapshots,decision,signal:new AbortController().signal,
   current:async name=>snapshot(name),onResult:result=>seen.push(result)});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(calls.length,3,'no NPC is awaited before the other ready requests dispatch');
 assert(calls.every(call=>!JSON.stringify(call.state).includes('view-')));
 assert(calls.every(call=>call.questions.length>1,'one state batches its independent questions'));
 releases.get('Bela')();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(seen[0].npc,'Bela','a slow peer does not hold the completed result callback');
 releases.get('Anna')();releases.get('Cora')();
 assert((await pending).every(row=>row.status==='ready'&&row.selected.intent.includes('Acknowledge')));
});
test('a changed perspective and an unsupported selected premise produce no adoptable intention',async()=>{
 const values=[snapshot('Anna'),snapshot('Bela')];
 const decision={decide:async batch=>{const r=answer(batch);if(batch.state.npc.name==='Bela')r.answers.eligible_0.choice='unsupported';return r;}};
 const result=await evaluateNpcResponses({campaign:'test',snapshots:values,decision,signal:new AbortController().signal,
   current:async name=>({...snapshot(name),...(name==='Anna'?{view_revision:'changed'}:{})})});
 assert.deepEqual(result.map(x=>x.status),['stale','unresolved']);
 assert(result.every(x=>x.selected===undefined));
});

test('a blocked freshness read cannot outlive the decision deadline',async()=>{
 let timer;
 try{
  const result=await Promise.race([
   evaluateNpcResponses({campaign:'test',snapshots:[snapshot('Anna')],decision:{decide:async batch=>answer(batch)},
    signal:new AbortController().signal,deadlineAt:Date.now()+30,current:async()=>new Promise(()=>{})}),
   new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('freshness read held the response past its deadline')),250);})
  ]);
  assert.equal(result[0].status,'unavailable');assert.equal(result[0].selected,undefined);
 }finally{clearTimeout(timer);}
});

test('NPC advice charges the actual parent budget and an exhausted parent prevents another dispatch',async()=>{
 const {TaskLease}=await import('../../runtime/jev/task-context.ts');
 const {createTaskProviderBudget}=await import('../../runtime/jev/provider-budget.ts');
 const parent=new TaskLease({owner:'keeper',goal:'Complete one player input',scope:{owner:'keeper',audience:'keeper'},readSet:[],capabilities:[],
  budget:{deadlineAt:Date.now()+5000,remainingInputTokens:50000,remainingOutputTokens:10000,remainingCostUsd:1,remainingActions:1}});
 let calls=0;
 try{
  const options={campaign:'test',snapshots:[snapshot('Anna')],signal:new AbortController().signal,providerBudget:createTaskProviderBudget(parent),
   current:async()=>snapshot('Anna'),decision:{decide:async batch=>{calls++;return {...answer(batch),usage:{inputTokens:200,outputTokens:20,costUsd:0.0000084}};}}};
  assert.equal((await evaluateNpcResponses(options))[0].status,'ready');
  assert.equal(parent.context.budget.remainingInputTokens,49800);
  assert.equal(parent.context.budget.remainingOutputTokens,9980);
  assert.equal(parent.context.budget.remainingActions,0);
  assert.equal((await evaluateNpcResponses(options))[0].status,'unavailable');
  assert.equal(calls,1,'optional advice cannot create fresh independent capacity under an exhausted parent');
 }finally{parent.close();}
});
