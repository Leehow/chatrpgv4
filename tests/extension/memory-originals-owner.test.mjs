import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createMemoryReadOwner} from '../../runtime/jev/memory-read-owner.ts';
import {TaskLease} from '../../runtime/jev/task-context.ts';

async function attempt(actions,count){
 const owners=new Map(),calls=[],scope={owner:'test',campaign:'c',audience:'keeper'},readSet=[];
 const lease=new TaskLease({owner:'test',goal:'Read originals',scope,capabilities:['recall'],readSet,
  budget:{deadlineAt:Date.now()+10000,remainingActions:actions,remainingInputTokens:1000,remainingOutputTokens:1000,remainingCostUsd:1}});
 const args={snapshot:'s',requests:Array.from({length:count},(_,i)=>({alias:`entry:${i}`}))};
 const runtime={begin:async()=>lease.context.id,snapshot:()=>({domain:{id:'memory-read'},plan:{goal:'Read originals'},observations:[]}),
  async submit(){const owner=owners.get('memory.originals');owner.validate(args);lease.reserve({inputTokens:0,outputTokens:0,costUsd:0,actions:1}).settle();
   await owner.execute({id:'operation',taskId:lease.context.id,args,readSet},{task:lease});
   return{status:'partial',remainingNeeds:[],coverage:{used:[],omitted:[],unknown:[]}};}};
 const owner=createMemoryReadOwner({runtime:()=>runtime,registerOwned:(name,value)=>{owners.set(name,value);return()=>owners.delete(name);},
  call:async(method,params)=>{calls.push({method,params});return{snapshot:'s',results:[]};}});
 let error;
 try{await owner.search({query:'Read originals',filters:{}},{operationId:'search',intent:{},lease:{}});}catch(value){error=value;}
 finally{owner.close();lease.close();}
 return{calls,error,budget:lease.context.budget};
}
test('a batch charges one lease action per original window',async()=>{
 const result=await attempt(9,8);assert.equal(result.error,undefined);assert.equal(result.calls.length,1);
 assert.equal(result.budget.remainingActions,1);assert.equal(result.calls[0].params.requests.length,8);
});
test('a batch cannot bypass the original-window allowance or its eight-window bound',async()=>{
 for(const [actions,count]of [[7,8],[20,9]]){const result=await attempt(actions,count);assert.ok(result.error);assert.equal(result.calls.length,0);}
});
