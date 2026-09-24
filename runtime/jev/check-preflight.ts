/** Optional read-only ordinary-check advice for the normal Keeper request. Never settlement authority. */
import {createHash} from 'node:crypto';
import {isPlainRecord,type DecisionBatch,type DecisionResult,type Json,type ReadSet,type ScopeBinding} from './contracts.ts';
import type {DecisionPort} from './decision-port.ts';
import type {TaskLease} from './task-context.ts';
import {packDecisionBatch} from './question-packing.ts';
import {interpretOrdinaryRoute,ordinaryActionTemplate,ordinaryProfileBatch,ordinaryRouteBatch,selectOrdinaryProfile,
  validateOrdinaryResolveOptions,type OrdinaryActionTemplate,type OrdinaryDisposition,type OrdinaryResolveOptions} from './ordinary-resolve-domain.ts';

const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export interface CheckPreflightAdvice {kind:'check_preflight';disposition:OrdinaryDisposition;action?:OrdinaryActionTemplate;
  unresolved:string[];authorization:'advisory_only';settled:false;basis?:Array<{role:'player'|'keeper';text:string}>}
export interface CheckPreflightCheckpoint {version:2;campaign:string;turn:number;worldline:string;loop:number;input_revision:string;world_revision:string;options_revision:string;
  profiles_revision:string;rules_revision:string;context_revision:string;public_context_revision:string}
/**
 * The profile answer behind the advised skill (contract §135.30.3, SL-26): its choice, confidence and distribution, by skill
 * name. A report beside the advice, which it does not change; the single-loop clerk reads it to say whether the skill cleared.
 */
export type CheckPreflightAnswer={choice:string;confidence:number|null;probabilities:Record<string,number>|null};
/** `route` and `consent`: the binder's own route and consent answers, reported for the record (they decide the disposition). */
export interface CheckPreflightEvidence {profile?:CheckPreflightAnswer;route?:CheckPreflightAnswer;consent?:CheckPreflightAnswer}
export interface CheckPreflightResult {advice:CheckPreflightAdvice;checkpoint?:CheckPreflightCheckpoint;decisionCalls:number;evidence?:CheckPreflightEvidence;
  check(signal?:AbortSignal,deadlineAt?:number):Promise<{status:'current'}|{status:'stale'|'unavailable';reason:string}>}
export interface CheckPreflightInput {campaign:string;turn:number;rawInput:string;goal?:string;scope:ScopeBinding;readSet:ReadSet;
  publicContext?:Array<{role:'player'|'keeper';text:string}>;
  call(method:string,params:Record<string,unknown>):Promise<unknown>;decision:DecisionPort;lease:TaskLease;signal?:AbortSignal}

function unknown(reason:string,calls=0):CheckPreflightResult {
  return{advice:{kind:'check_preflight',disposition:'unknown',unresolved:[reason],authorization:'advisory_only',settled:false},decisionCalls:calls,
    check:async()=>({status:'unavailable',reason})};
}
function checkpoint(input:Pick<CheckPreflightInput,'campaign'|'turn'|'scope'|'rawInput'|'publicContext'>,options:OrdinaryResolveOptions):CheckPreflightCheckpoint {
  return{version:2,campaign:input.campaign,turn:input.turn,worldline:input.scope.worldline!,loop:input.scope.loop!,
    input_revision:digest(input.rawInput),world_revision:options.world_revision,options_revision:options.revision,
    profiles_revision:digest(options.profiles),rules_revision:digest(options.decisions),context_revision:digest(options.context),public_context_revision:digest(input.publicContext??[])};
}
function same(left:CheckPreflightCheckpoint,right:CheckPreflightCheckpoint):boolean {
  return Object.keys(left).every(key=>left[key as keyof CheckPreflightCheckpoint]===right[key as keyof CheckPreflightCheckpoint]);
}
function batch(value:Omit<DecisionBatch,'id'|'scope'|'readSet'>,scope:ScopeBinding,readSet:ReadSet,ordinal:number):DecisionBatch {
  const result={...value,id:digest(['check-preflight',ordinal,value.state,value.questions,scope,readSet]),scope,readSet};packDecisionBatch(result);return result;
}
function failure(result:DecisionResult):string {
  return result.failure?.code??(result.status==='incomplete'?'decision_incomplete':'decision_unavailable');
}
async function bounded<T>(work:()=>Promise<T>,signal:AbortSignal,deadlineAt:number):Promise<T> {
  signal.throwIfAborted();const remaining=deadlineAt-Date.now();if(remaining<=0)throw new Error('check_preflight_deadline');
  let abort=()=>{},timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([work(),new Promise<never>((_,reject)=>{
    abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true});
    timer=setTimeout(()=>reject(new Error('check_preflight_deadline')),remaining);if(signal.aborted)abort();
  })]);}finally{if(timer)clearTimeout(timer);signal.removeEventListener('abort',abort);}
}
function boundOptions(input:Pick<CheckPreflightInput,'campaign'|'turn'|'scope'|'rawInput'>,value:unknown):OrdinaryResolveOptions|undefined {
  const options=validateOrdinaryResolveOptions(value),binding=options?.context._binding;
  return options&&isPlainRecord(binding)&&binding.campaign===input.campaign&&binding.turn===input.turn
    &&binding.worldline===input.scope.worldline&&binding.loop===input.scope.loop&&options.context.declared_action===input.rawInput?options:undefined;
}
export async function recheckPreflight(input:Pick<CheckPreflightInput,'campaign'|'turn'|'scope'|'rawInput'|'publicContext'|'call'>
  &{checkpoint:CheckPreflightCheckpoint;signal:AbortSignal;deadlineAt:number}):Promise<{status:'current'}|{status:'stale'|'unavailable';reason:string}> {
  try{
    if(input.checkpoint.version!==2||input.campaign!==input.scope.campaign)return{status:'stale',reason:'check_preflight_scope_changed'};
    const raw=await bounded(()=>input.call('table.resolve.options',{campaign:input.campaign}),input.signal,input.deadlineAt);
    const current=boundOptions(input,raw);if(!current)return{status:'stale',reason:'resolve_options_changed'};
    return same(input.checkpoint,checkpoint(input,current))?{status:'current'}:{status:'stale',reason:'resolve_options_changed'};
  }catch(error){return{status:'unavailable',reason:input.signal.aborted?'cancelled':error instanceof Error?error.message:'resolve_options_unavailable'};}
}

/** A choice answer as the record keeps it. */
function answerRecord(result:DecisionResult,key:string):CheckPreflightAnswer|undefined {
  const value=result.answers?.[key];if(value?.status!=='answered'||value.type!=='choice')return undefined;
  return{choice:value.choice,confidence:typeof value.confidence==='number'?value.confidence:null,probabilities:value.probabilities??null};
}
function routeEvidence(result:DecisionResult):CheckPreflightEvidence {
  const route=answerRecord(result,'route'),consent=answerRecord(result,'consent');
  return{...(route?{route}:{}),...(consent?{consent}:{})};
}
/** The profile answer by skill name: the question's aliases (`profile_<index>` over the actor's own rows) read back. */
function profileEvidence(options:OrdinaryResolveOptions,actor:string,result:DecisionResult):CheckPreflightEvidence|undefined {
  const value=result.answers?.profile;if(value?.status!=='answered'||value.type!=='choice')return undefined;
  const skills=Object.fromEntries(options.profiles.filter(row=>row.actor===actor).map((row,index)=>[`profile_${index}`,row.skill]));
  const name=(alias:string)=>skills[alias]??alias;
  return{profile:{choice:name(value.choice),confidence:typeof value.confidence==='number'?value.confidence:null,
    probabilities:value.probabilities?Object.fromEntries(Object.entries(value.probabilities).map(([alias,p])=>[name(alias),p])):null}};
}
export async function prepareCheckPreflight(input:CheckPreflightInput):Promise<CheckPreflightResult> {
  const goal=input.goal?.trim()||input.rawInput,lease=input.lease,signal=input.signal?AbortSignal.any([input.signal,lease.signal]):lease.signal;let calls=0;
  try{
    if(!input.campaign||!input.rawInput.trim()||input.campaign!==input.scope.campaign||!Number.isSafeInteger(input.turn)
      ||typeof input.scope.worldline!=='string'||!Number.isSafeInteger(input.scope.loop))return unknown('check_preflight_input_unavailable');
    signal?.throwIfAborted();lease.assertActive();
    const shared=lease.context;
    if(digest(shared.scope)!==digest(input.scope)||digest(shared.readSet)!==digest(input.readSet))return unknown('check_preflight_lease_binding_mismatch');
    const raw=await bounded(()=>input.call('table.resolve.options',{campaign:input.campaign}),signal,lease.context.budget.deadlineAt);signal.throwIfAborted();lease.assertActive();
    const options=boundOptions(input,raw);if(!options)return unknown('resolve_options_unavailable');
    const captured=checkpoint(input,options),decisionOptions={...options,context:{...options.context,public_context:input.publicContext??[]}};
    const make=(advice:CheckPreflightAdvice):CheckPreflightResult=>({advice:{...advice,basis:[{role:'player',text:input.rawInput},...(input.publicContext??[])]},
      checkpoint:captured,decisionCalls:calls,check:(checkSignal=signal,deadlineAt=lease.context.budget.deadlineAt)=>
        recheckPreflight({...input,checkpoint:captured,signal:checkSignal,deadlineAt})});
    if(options.context.pending_choice)return make({kind:'check_preflight',disposition:'needs_player',unresolved:['The existing pending mechanical choice must be resolved by its owner.'],authorization:'advisory_only',settled:false});
    if(options.context.session)return make({kind:'check_preflight',disposition:'incumbent',unresolved:['The active subsystem requires its existing resolution owner.'],authorization:'advisory_only',settled:false});
    const routeRequest=batch(ordinaryRouteBatch({rawInput:input.rawInput,goal,options:decisionOptions}),input.scope,input.readSet,0);calls++;
    const routeResult=await bounded(()=>input.decision.decide(routeRequest,lease),signal,lease.context.budget.deadlineAt);signal.throwIfAborted();lease.assertActive();
    if(routeResult.status!=='complete')return make({kind:'check_preflight',disposition:'unknown',unresolved:[failure(routeResult)],authorization:'advisory_only',settled:false});
    const route=interpretOrdinaryRoute(options,routeResult),routed=routeEvidence(routeResult);
    if(route.disposition!=='ordinary')return{...make({kind:'check_preflight',disposition:route.disposition,unresolved:route.needs,authorization:'advisory_only',settled:false}),evidence:routed};
    const profileSpec=ordinaryProfileBatch({rawInput:input.rawInput,goal,options:decisionOptions,route});if(!profileSpec)
      return make({kind:'check_preflight',disposition:'unknown',unresolved:['ordinary_profile_unavailable'],authorization:'advisory_only',settled:false});
    const profileRequest=batch(profileSpec,input.scope,input.readSet,1);calls++;
    const profileResult=await bounded(()=>input.decision.decide(profileRequest,lease),signal,lease.context.budget.deadlineAt);signal.throwIfAborted();lease.assertActive();
    if(profileResult.status!=='complete')return make({kind:'check_preflight',disposition:'unknown',unresolved:[failure(profileResult)],authorization:'advisory_only',settled:false});
    const profile=selectOrdinaryProfile(options,route,profileResult),action=profile&&ordinaryActionTemplate({rawInput:input.rawInput,goal,options,route,profile});
    const evidence={...routed,...profileEvidence(options,route.actor!,profileResult)};
    return action?{...make({kind:'check_preflight',disposition:'ordinary',action,unresolved:[],authorization:'advisory_only',settled:false}),evidence}
      :make({kind:'check_preflight',disposition:'unknown',unresolved:['ordinary_profile_unavailable'],authorization:'advisory_only',settled:false});
  }catch(error){return unknown(signal?.aborted||lease.signal.aborted?'cancelled':error instanceof Error?error.message:'check_preflight_unavailable',calls);}
}
