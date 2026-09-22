/** A single bounded foreground preparation owner over the existing shared decision port. */
import {TaskLease} from './task-context.ts';
import {createTaskProviderBudget,type TaskProviderBudget} from './provider-budget.ts';
import type {DecisionPort} from './decision-port.ts';
import {packDecisionBatch,JEV_MODEL} from './question-packing.ts';
import {JEV_INPUT_USD_PER_MILLION} from './decision-adapter.ts';

export function preparationBudget(options:{decision:DecisionPort;campaign:string;deadlineAt:number;signal:AbortSignal;parent?:TaskProviderBudget;
    owner?:string;goal?:string}) {
    const signal=options.parent?AbortSignal.any([options.signal,options.parent.signal]):options.signal;
    const owner=options.owner??'keeper-preparation';
    const lease=new TaskLease({owner,goal:options.goal??'Prepare evidence and NPC intentions for one player input',
        scope:{owner,campaign:options.campaign,audience:'keeper'},capabilities:['decision'],readSet:[],signal,
        budget:{deadlineAt:Math.min(options.deadlineAt,options.parent?.deadlineAt??Infinity),remainingActions:8,
            remainingInputTokens:400_000,remainingOutputTokens:40_000,remainingCostUsd:.04}});
    const budget=createTaskProviderBudget(lease);
    const decision:DecisionPort={async decide(batch,child){
        const {estimate}=packDecisionBatch(batch),bound={model:{provider:'typesafe',id:JEV_MODEL,api:'typesafe-systemone',maxTokens:estimate.responseUpperBound,
            contextWindow:32768,cost:{input:JEV_INPUT_USD_PER_MILLION,output:0,cacheRead:JEV_INPUT_USD_PER_MILLION,cacheWrite:JEV_INPUT_USD_PER_MILLION}},
            inputTokens:estimate.totalUpperBound,outputTokens:estimate.responseUpperBound};
        const local=await budget.reserve(bound,child.signal);
        let parent:Awaited<ReturnType<TaskProviderBudget['reserve']>>|undefined;
        try{parent=await options.parent?.reserve(bound,child.signal);}catch(error){local.release();throw error;}
        try{
            const result=await options.decision.decide(batch,child);
            if(result.attempts===0){local.release();parent?.release();}
            else{
                const usage=result.usage?{input:result.usage.inputTokens,output:result.usage.outputTokens,cacheRead:0,cacheWrite:0,cost:{total:result.usage.costUsd}}:undefined;
                local.settle(usage);parent?.settle(usage);
            }
            return result;
        }catch(error){local.settle();parent?.settle();throw error;}
    }};
    return {decision,close:()=>lease.close()};
}
