/** A single bounded foreground preparation owner over the existing shared decision port. */
import {TaskLease} from './task-context.ts';
import {createTaskProviderBudget,type TaskProviderBudget} from './provider-budget.ts';
import type {DecisionPort} from './decision-port.ts';
import {packDecisionBatch,JEV_MODEL,JEV_REQUEST_TOKEN_LIMIT} from './question-packing.ts';
import {JEV_INPUT_USD_PER_MILLION} from './decision-adapter.ts';

/**
 * Per-input decision allowance shared by every optional preparation lane (contract §124.10). Token and cost
 * figures bound reservations made from byte upper bounds; they are settled with provider-reported usage.
 */
export const PREPARATION_DECISION_BUDGET=Object.freeze({actions:24,inputTokens:1_200_000,outputTokens:80_000,costUsd:.08});
export const preparationProviderBudget=():{actions:number;inputTokens:number;outputTokens:number;costUsd:number}=>({...PREPARATION_DECISION_BUDGET});

export function preparationBudget(options:{decision:DecisionPort;campaign:string;deadlineAt:number;signal:AbortSignal;parent?:TaskProviderBudget;
    owner?:string;goal?:string}) {
    const signal=options.parent?AbortSignal.any([options.signal,options.parent.signal]):options.signal;
    const owner=options.owner??'keeper-preparation';
    const lease=new TaskLease({owner,goal:options.goal??'Prepare evidence and NPC intentions for one player input',
        scope:{owner,campaign:options.campaign,audience:'keeper'},capabilities:['decision'],readSet:[],signal,
        budget:{deadlineAt:Math.min(options.deadlineAt,options.parent?.deadlineAt??Infinity),remainingActions:PREPARATION_DECISION_BUDGET.actions,
            remainingInputTokens:PREPARATION_DECISION_BUDGET.inputTokens,remainingOutputTokens:PREPARATION_DECISION_BUDGET.outputTokens,
            remainingCostUsd:PREPARATION_DECISION_BUDGET.costUsd}});
    const budget=createTaskProviderBudget(lease);
    const decision:DecisionPort={async decide(batch,child){
        const {estimate}=packDecisionBatch(batch),bound={model:{provider:'typesafe',id:JEV_MODEL,api:'typesafe-systemone',maxTokens:estimate.responseUpperBound,
            contextWindow:JEV_REQUEST_TOKEN_LIMIT,cost:{input:JEV_INPUT_USD_PER_MILLION,output:0,cacheRead:JEV_INPUT_USD_PER_MILLION,cacheWrite:JEV_INPUT_USD_PER_MILLION}},
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
