/** Read-only owner regression: a long history must reach semantic selection and its late original. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {TaskRuntime} from '../../runtime/jev/task-runtime.ts';
import {createMemoryReadDomain} from '../../runtime/jev/memory-read-domain.ts';
import {createMemoryReadOwner,memoryReadBudget,MEMORY_READ_STEP_LIMIT} from '../../runtime/jev/memory-read-owner.ts';
import {createCanonicalOperationDispatcher} from '../../extensions/kernel/canonical-operation-dispatcher.ts';
import {bindDecisionAnswers} from '../../runtime/jev/contracts.ts';
import {packDecisionBatch} from '../../runtime/jev/question-packing.ts';
import {JEV_INPUT_USD_PER_MILLION} from '../../runtime/jev/decision-adapter.ts';
import {PREPARATION_DECISION_BUDGET} from '../../runtime/jev/preparation-budget.ts';

async function query(useMemoryBudget) {
    const total=1262, tail=`entry:${total-1}`, records=new Map(), calls=[], decisions=[];
    const scope={owner:'memory-budget',campaign:'fixture',worldline:'main',loop:0,audience:'keeper'};
    const readSet=[{kind:'world',resource:'fixture',revision:'unchanged'}];
    const intent={id:'query',scope,turn:1,inputRevision:'input',limits:['read_only'],
        rawInput:{version:1,scope,resource:'query',revision:'input',sourceType:'draft',selector:{kind:'field',path:['query']}}};
    const dispatcher=createCanonicalOperationDispatcher();
    const runtime=new TaskRuntime({maxSteps:useMemoryBudget?MEMORY_READ_STEP_LIMIT:32,
        domains:[createMemoryReadDomain()],store:{load:async id=>records.get(id),save:async row=>records.set(row.checkpoint.context.id,structuredClone(row))},
        decision:{async decide(batch,lease){
            const {estimate}=packDecisionBatch(batch), spend={inputTokens:estimate.totalUpperBound,
                outputTokens:estimate.responseUpperBound,costUsd:estimate.totalUpperBound*JEV_INPUT_USD_PER_MILLION/1_000_000,actions:1};
            const reservation=await lease.reserveQueued(spend);
            decisions.push(batch);
            reservation.settle();
            return bindDecisionAnswers(batch,Object.fromEntries(batch.questions.map(q=>[q.key,{status:'answered',type:'choice',
                choice:q.key.startsWith('coverage:')?(q.target===tail?'essential':'irrelevant'):
                    q.key.startsWith('support:')?'supported':q.key.startsWith('applicability:')?'current':'none'}])),
                {inputTokens:spend.inputTokens,outputTokens:spend.outputTokens,costUsd:spend.costUsd});
        }},operations:{validate:async()=>readSet,dispatch:(proposal,task,journal)=>dispatcher.dispatch(proposal,
            {task,journal,validateCurrent:async()=>task.revalidate(readSet),recover:async()=>({status:'absent'}),trace:()=>{}})}});
    const entry=i=>({alias:`entry:${i}`,origin:'memory',kind:'fact',subject:'Witness',text:`Retained report ${i}. `+
        'The witness recorded the time, the speaker and the conditional promise without establishing world truth. '.repeat(2),
        turn:i,line:'main',loop:0,status:'candidate',state:'accurate',authority:'conversation_report',attribution:{kind:'speech'},derived:false,links:[]});
    const leaf=createMemoryReadOwner({runtime:()=>runtime,registerOwned:(name,owner)=>dispatcher.registerOwned(name,owner),
        async call(method,p){
            assert.equal(method,'memory.evidence'); calls.push(p);
            if(p.action==='snapshot')return{snapshot:'fixed',raw_all:false,total,indexed:total,raw:0,
                coverage:{raw_gap_turns:[],raw_unavailable_lines:[]},context:{}};
            if(p.action==='page'){const end=Math.min(total,p.offset+20);return{snapshot:'fixed',offset:p.offset,total,
                rows:Array.from({length:end-p.offset},(_,i)=>entry(p.offset+i)),next_offset:end<total?end:null};}
            if(p.action==='originals'){assert.deepEqual(p.requests,[{alias:tail}]);return{snapshot:p.snapshot,results:[{alias:tail,verified:true,entry:entry(total-1),
                authority:'conversation_report',context:[{role:'keeper',text:'The final retained conditional promise.',range:{offset:0,end:39}}]}]};}
            if(p.action==='finish'){assert.equal(p.considered.length,total);assert.deepEqual(p.selected,[tail]);
                return{what:'memory',status:'ready',hits:[{alias:tail,text:'The final retained conditional promise.'}],
                    coverage:{used:[tail],omitted:[],unknown:[]}};}
            throw new Error(`Unexpected owner action ${p.action}`);
        }});
    const deadlineAt=Date.now()+45_000, old=PREPARATION_DECISION_BUDGET;
    try {
        const result=await leaf.search({query:'Which retained occurrence carries the requested promise?',filters:{}},
            {operationId:'read',intent,lease:{owner:'memory-read',goal:'Find the retained promise',scope,capabilities:['recall'],readSet,
                budget:useMemoryBudget?memoryReadBudget(deadlineAt):{deadlineAt,remainingActions:old.actions,
                    remainingInputTokens:old.inputTokens,remainingOutputTokens:old.outputTokens,remainingCostUsd:old.costUsd}}});
        return {result,calls,decisions,record:[...records.values()].at(-1)};
    } finally {leaf.close();await runtime.shutdown();}
}

test('preparation allowance stops a long query before selection; the memory allowance reaches the same last occurrence',async()=>{
    const before=await query(false);
    assert.equal(before.result.result.status,'unavailable');
    assert.equal(before.decisions.length,0);
    const after=await query(true);
    assert.equal(after.result.result.status,'ready',JSON.stringify(after.result));
    assert.equal(after.calls.filter(p=>p.action==='page').length,64);
    assert.ok(after.decisions.length>0);
    assert.deepEqual(after.result.result.coverage.used,['entry:1261']);
    assert.equal(after.record.checkpoint.context.budget.deadlineAt>0,true);
    assert.ok(after.record.checkpoint.context.budget.remainingCostUsd>=0);
    assert.ok(after.record.steps<=MEMORY_READ_STEP_LIMIT);
    const budget=memoryReadBudget(123);
    assert.equal(budget.deadlineAt,123);
    assert.equal(budget.remainingCostUsd,PREPARATION_DECISION_BUDGET.costUsd);
});
