import assert from 'node:assert/strict';import {test} from 'node:test';
import {TaskLease} from '../../runtime/jev/task-context.ts';
import {expressionReferenceBindings,selectExpressionReferences} from '../../runtime/jev/expression-reference-selection.ts';
const card=(name,kind)=>({name,kind,activation_question:'Is the targeted person responding to the current request?',applies:'When current context supports this manner.',pattern:'Respond to the actual utterance.',examples:[{context:'A calm request.',reply:'Please come in.'}]});
const input=()=>({campaign:'c',worldline:'main',loop:0,turn:2,revision:'catalog-v1',context:{utterance:'What happened?',people:[{name:'Clerk',voice:'Formal when explaining.'}]},cards:[card('Formal','habit'),card('Explain','interaction'),card('Threat','interaction')]});
function lease(i){const b=expressionReferenceBindings(i);return new TaskLease({owner:b.scope.owner,goal:'Select advisory expression references',...b,capabilities:['decision'],budget:{deadlineAt:Date.now()+3000,remainingInputTokens:100000,remainingOutputTokens:10000,remainingCostUsd:1,remainingActions:1}});}
test('one fanout selects at most one card of each kind and materializes exact supplied content',async()=>{
 const i=input(),l=lease(i);let calls=0, observed;
 try{const result=await selectExpressionReferences(i,{decide:async batch=>{calls++;assert.equal(batch.questions.length,7);observed=batch.state.cards[0].examples;return{batchId:batch.id,status:'complete',coverage:{required:[],answered:[],unknown:[]},issues:[],answers:Object.fromEntries(batch.questions.map(q=>[q.key,{status:'answered',type:'noul',noul:q.key.startsWith('conflict_')?(q.key==='conflict_0_2'?.96:.02):.96}]))};}},l,{minFit:.8,minParticipant:.8,maxConflict:.2,byteBudget:2200});
 assert.deepEqual(observed,i.cards[0].examples,'the selector sees the wording it will later materialize');assert.equal(calls,1);assert.deepEqual(result.people[0].cards,[i.cards[1],i.cards[0]]);assert.ok(!JSON.stringify(result.people).includes('Threat'));}
 finally{l.close()}
});
