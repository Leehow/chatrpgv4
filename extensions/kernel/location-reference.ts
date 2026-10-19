/** Jev advises a missing semantic reference; it never authorizes or rewrites a location. */
import {createHash} from 'node:crypto';
import {readJevApiKey} from '../jev/agent/config.js';
import {createDecisionAdapter} from '../../runtime/jev/decision-adapter.ts';
import {TaskLease} from '../../runtime/jev/task-context.ts';
import {scenePlacementBudget} from '../../runtime/jev/scene-placement.ts';
import {JEV_MODEL} from '../../runtime/jev/question-packing.ts';
import type {DecisionBatch,DecisionResult,Json} from '../../runtime/jev/contracts.ts';
import type {DecisionPort} from '../../runtime/jev/decision-port.ts';
type Row=Record<string,any>;
export function locationReferenceBatch(read:Row,campaign:string,turn:number):DecisionBatch {
    const revision=createHash('sha256').update(JSON.stringify(read)).digest('hex');
    const candidates=(read.candidates??[]).slice(0,24),names=Object.fromEntries(candidates.map((candidate:Row,index:number)=>[`c${index}`,candidate]));
    const references={...Object.fromEntries(candidates.map((candidate:Row,index:number)=>[`c${index}`,`${candidate.kind}: ${candidate.name}; identity itself, not merely inside it.`])),none:'No candidate is the target itself.',uncertain:'Insufficient evidence to bind an identity.'};
    const containers={...Object.fromEntries(candidates.flatMap((candidate:Row,index:number)=>candidate.kind==='place'?[[`c${index}`,`${candidate.name}: the target is a smaller area inside this place.`]]:[])),none:'No listed container is established.',uncertain:'Its containing place is uncertain.'};
    return {id:`location-reference:${turn}:${revision.slice(0,12)}`,model:JEV_MODEL,family:'location-reference',familyVersion:'1',scope:{owner:'location-reference',campaign,audience:'keeper'},
        readSet:[{kind:'draft',resource:`turn:${turn}:location-reference`,revision}],
        state:{target:read.query,current:read.current,coverage:read.coverage,candidates:names} as Json,questions:[
            {key:'reference',type:'choice',target:'the identity of the requested target',criteria:references,instructions:'Match the target itself by meaning. A room inside a hotel is not the hotel itself. A bounded catalogue is not the world; choose none or uncertain freely. Source origin is provenance, not proof of current access.'},
            {key:'within',type:'choice',target:'the containing place if established',criteria:containers,instructions:'Choose only a supported containing place, preferring the smallest containing area. The departure place is not an implicit parent. None and uncertain are valid.'},
            {key:'scale',type:'choice',target:'the useful scale of the requested target',criteria:{place:'An independently enterable destination.',subplace:'An independently enterable area within a larger place.',feature:'A relative spot or reference within a place, without needing another scene.',uncertain:'Context does not establish the scale.'},instructions:'Judge the actual requested target in context. There is no fixed building taxonomy. This advice creates no world facts.'},
        ]};
}
export function locationReferenceAdvice(read:Row,result:DecisionResult):Row {
    const reference=result.answers.reference,within=result.answers.within,scale=result.answers.scale;
    const picked=(answer:any)=>answer?.status==='answered'&&answer.type==='choice'&&/^c[0-9]+$/.test(answer.choice)?read.candidates?.[Number(answer.choice.slice(1))]:undefined;
    const match=picked(reference),parent=picked(within),confidence=reference?.status==='answered'&&reference.type==='choice'?reference.confidence??0:0;
    return {authority:'Advisory only; the Keeper decides, canonical effects commit.',status:match&&confidence>=0.75?'matched':reference?.status==='answered'&&reference.type==='choice'&&reference.choice==='none'&&confidence>=0.75?'unmatched':'uncertain',
        ...(match?{candidate:match}:{}),...(parent&&within?.status==='answered'&&within.type==='choice'&&(within.confidence??0)>=0.75?{within:parent.name}:{}),...(scale?.status==='answered'&&scale.type==='choice'?{scale:scale.choice}:{}),confidence};
}
export async function adviseLocationReference(read:Row,deps:{env:NodeJS.ProcessEnv;campaign:string;turn:number;signal?:AbortSignal;record:(value:Row)=>unknown;decision?:DecisionPort}):Promise<Row> {
    if(!readJevApiKey(deps.env)&&!deps.decision)return {status:'unavailable',reason:'Jev is not configured; compatible creation remains available.'};
    const budget=await scenePlacementBudget(),batch=locationReferenceBatch(read,deps.campaign,deps.turn),began=Date.now();
    const signal=AbortSignal.any([...(deps.signal?[deps.signal]:[]),AbortSignal.timeout(budget.timeoutMs)]);
    const lease=new TaskLease({owner:'location-reference',goal:'Advise a semantic place reference',scope:batch.scope,readSet:batch.readSet,capabilities:['decision'],signal,
        budget:{deadlineAt:began+budget.timeoutMs,remainingActions:1,remainingInputTokens:20000,remainingOutputTokens:2000,remainingCostUsd:0.02}});
    try{
        const decision=deps.decision??createDecisionAdapter({env:deps.env,maxConcurrency:1});
        const result=await decision.decide(batch,lease),advice=locationReferenceAdvice(read,result);
        await deps.record({lane:'location-reference',turn:deps.turn,...advice,ms:Date.now()-began,usage:result.usage??null});return advice;
    }catch(error){
        const reason=signal.aborted?'unavailable_or_late':String((error as Error)?.message??error).slice(0,160);
        await deps.record({lane:'location-reference',turn:deps.turn,status:'unavailable',reason,ms:Date.now()-began});return {status:'unavailable',reason};
    }finally{lease.close();}
}
