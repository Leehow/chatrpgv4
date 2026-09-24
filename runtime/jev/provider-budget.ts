/** Host-only accounting for nested provider calls. The main Keeper has its own owner hook. */
import {TaskLease, BudgetRefusal, type BudgetSpend} from './task-context.ts';
import {ContractError} from './contracts.ts';

export interface ProviderModel {
  provider:string; id:string; api:string; maxTokens:number; contextWindow:number;
  cost:{input:number;output:number;cacheRead:number;cacheWrite:number;tiers?:Array<{input:number;output:number;cacheRead:number;cacheWrite:number}>};
}
export interface ProviderBound {model:ProviderModel;inputTokens:number;outputTokens:number}
export interface ProviderCharge {settle(usage?:unknown):void;release():void}
export interface TaskProviderBudget {
  readonly signal:AbortSignal;
  readonly deadlineAt:number;
  /** The output bound a child applies to each call (§20 addendum 2); absent means the default 8,192. */
  readonly callOutputTokens?:number;
  reserve(bound:ProviderBound, signal?:AbortSignal):Promise<ProviderCharge>;
}
/** The closed causes of a provider refusal (contract §20 addendum 2, SL-35). */
export type ProviderRefusalReason='budget_input_tokens'|'budget_output_tokens'|'budget_actions'|'budget_usd'|'budget_deadline'|'unknown_reservation'|'provider_protocol'|'transport';
export interface ProviderRefusal {
  reason:ProviderRefusalReason; code:string; dimension?:keyof BudgetSpend; ceiling?:number; used?:number; held?:number; requested?:number;
  reserved?:number; overrun?:true; after_provider_error?:string; unknown_usage_calls:number;
}
const DIMENSION_REASON:Record<keyof BudgetSpend,ProviderRefusalReason>={inputTokens:'budget_input_tokens',outputTokens:'budget_output_tokens',actions:'budget_actions',costUsd:'budget_usd'};
/** Codes the host's own checks of a child's reservation request raise: the child broke the channel's protocol. */
const PROTOCOL_CODES=new Set(['invalid_provider_request_identity','provider_model_changed','provider_bound_unavailable','provider_output_bound_unsupported','provider_payload_unavailable']);
// A child reports its own failure as the string of its error; the code is what follows `ContractError: `.
const codeOf=(error:unknown):string=>error instanceof ContractError?error.code
  :String(error instanceof Error?error.message:error).replace(/^(?:Error: )*ContractError: /,'');
/** What refused a child's provider call, typed by the error the host's accounting raised. Never guessed from prose. */
export function providerRefusal(error:unknown, context:{afterProviderError?:string;unknownCalls?:number}={}):ProviderRefusal {
  const code=codeOf(error), common={code,unknown_usage_calls:context.unknownCalls??0,...(context.afterProviderError?{after_provider_error:context.afterProviderError.slice(0,300)}:{})};
  if(error instanceof BudgetRefusal)return {reason:DIMENSION_REASON[error.refusal.dimension],...common,...error.refusal};
  if(code==='task_deadline')return {reason:'budget_deadline',...common};
  if(code==='unknown_provider_reservation')return {reason:'unknown_reservation',...common};
  if(PROTOCOL_CODES.has(code))return {reason:'provider_protocol',...common};
  return {reason:'transport',...common};
}
/** One English line for logs and the job's refusal: the reason, then the numbers. */
export function providerRefusalText(refusal:ProviderRefusal):string {
  const numbers=refusal.dimension?`${refusal.overrun?`a call reported ${refusal.requested} ${refusal.dimension} against ${refusal.reserved} reserved`
    :`the call asked for ${refusal.requested} ${refusal.dimension}`}; the lease's ceiling is ${refusal.ceiling}, ${refusal.used} used, ${refusal.held} held by other calls`:refusal.code;
  const extra=[refusal.unknown_usage_calls?`${refusal.unknown_usage_calls} call(s) ended without usage and were charged their whole reservation`:'',
    refusal.after_provider_error?`after the provider error "${refusal.after_provider_error}"`:''].filter(Boolean).join('; ');
  return `provider_budget_refused: ${refusal.reason} (${numbers}${extra?`; ${extra}`:''})`;
}
export interface ProviderUsage {inputTokens:number;outputTokens:number;costUsd:number;actions:number}
const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
const integer=(value:unknown):value is number=>finite(value)&&Number.isSafeInteger(value);
export function providerUsage(value:any):ProviderUsage|undefined {
  if(!value||![value.input,value.output,value.cacheRead,value.cacheWrite].every(integer)||!integer(value.input+value.cacheRead+value.cacheWrite)||!finite(value.cost?.total))return;
  return {inputTokens:value.input+value.cacheRead+value.cacheWrite,outputTokens:value.output,costUsd:value.cost.total,actions:1};
}
export function providerSpend(bound:ProviderBound):BudgetSpend {
  const model=bound?.model, rates=model?.cost?[model.cost,...(model.cost.tiers??[])]:[];
  if(!model||!['provider','id','api'].every(key=>typeof model[key as keyof ProviderModel]==='string'&&!!model[key as keyof ProviderModel])
    ||!integer(model.contextWindow)||model.contextWindow<1||!integer(model.maxTokens)||model.maxTokens<1
    ||!integer(bound.inputTokens)||!integer(bound.outputTokens)||bound.outputTokens<1||bound.outputTokens>model.maxTokens
    ||!rates.length||rates.some(rate=>![rate.input,rate.output,rate.cacheRead,rate.cacheWrite].every(finite)))throw new ContractError('provider_bound_unavailable');
  return {inputTokens:bound.inputTokens,outputTokens:bound.outputTokens,actions:1,costUsd:
    (bound.inputTokens*Math.max(...rates.flatMap(rate=>[rate.input,rate.cacheRead,rate.cacheWrite]))+bound.outputTokens*Math.max(...rates.map(rate=>rate.output)))/1_000_000};
}
/** Provider-specific output fields are closed API syntax, never inferred from prose. */
export function boundProviderRequest(model:ProviderModel, payload:any, outputLimit=8192):{payload:any;bound:ProviderBound} {
  if(!payload||typeof payload!=='object'||Array.isArray(payload))throw new ContractError('provider_payload_unavailable');
  let path:string[];
  switch(model.api) {
    case 'openai-responses':case 'azure-openai-responses':case 'openai-codex-responses':path=['max_output_tokens'];break;
    case 'openai-completions':path=[Object.hasOwn(payload,'max_completion_tokens')?'max_completion_tokens':'max_tokens'];break;
    case 'anthropic-messages':path=['max_tokens'];break;
    case 'pi-messages':path=['options','maxTokens'];break;
    case 'google-generative-ai':case 'google-vertex':path=['config','maxOutputTokens'];break;
    case 'bedrock-converse-stream':path=['inferenceConfig','maxTokens'];break;
    default:throw new ContractError('provider_output_bound_unsupported');
  }
  const existing=path.reduce((value,key)=>value?.[key],payload);
  const outputTokens=Math.min(model.maxTokens,outputLimit,typeof existing==='number'?existing:Infinity);
  const body=JSON.stringify(payload);
  // Compressed image bytes do not bound vision token use. Reserve the declared context ceiling.
  const multimodal=(value:any):boolean=>!!value&&typeof value==='object'&&(Array.isArray(value)?value.some(multimodal):
    ['image','input_image','image_url','document','input_audio'].includes(value.type)||Object.hasOwn(value,'image')||Object.hasOwn(value,'inlineData')||Object.hasOwn(value,'inline_data')||Object.values(value).some(multimodal));
  const inputTokens=multimodal(payload)?model.contextWindow:Buffer.byteLength(body,'utf8')+1024;
  const bounded=structuredClone(payload);let target=bounded;
  for(const key of path.slice(0,-1))target=target[key]??=( {} );target[path.at(-1)!]=outputTokens;
  // Explicitly copy only public model accounting metadata across the child boundary.
  const bound={model:{provider:model.provider,id:model.id,api:model.api,maxTokens:model.maxTokens,contextWindow:model.contextWindow,cost:structuredClone(model.cost)},inputTokens,outputTokens};
  providerSpend(bound);
  return {payload:bounded,bound};
}
export function createTaskProviderBudget(lease:TaskLease, options:{record?:(event:Record<string,unknown>)=>void;changed?:()=>void|Promise<void>;callOutputTokens?:number}={}):TaskProviderBudget {
  const emit=(event:Record<string,unknown>)=>{try{options.record?.({...event,taskId:lease.context.id,rootId:lease.context.rootId});}catch{/* Accounting does not depend on telemetry. */}};
  const changed=async()=>{await options.changed?.();};
  // Refunds may lag on disk; a conservative dispatched reservation must not.
  const changedLater=()=>{void changed().catch(()=>{});};
  return {signal:lease.signal,deadlineAt:lease.context.budget.deadlineAt,...(options.callOutputTokens?{callOutputTokens:options.callOutputTokens}:{}),async reserve(bound,signal) {
    const spend=providerSpend(bound);
    const reservation=await lease.reserveQueued(spend,signal);
    try {
      await changed();
      lease.assertActive();
      signal?.throwIfAborted();
    } catch(error) {reservation.release();changedLater();throw error;}
    emit({kind:'provider-reservation',model:`${bound.model.provider}/${bound.model.id}`,reserved:spend});
    let done=false;
    return {settle(usage) {if(done)return;done=true;const actual=providerUsage(usage);
      try{emit({kind:'provider-usage',model:`${bound.model.provider}/${bound.model.id}`,usage:actual??spend,known:!!actual});reservation.settle(actual);}
      finally{changedLater();}},release(){if(done)return;done=true;try{reservation.release();emit({kind:'provider-undispatched'});}finally{changedLater();}}};
  }};
}
/** A separately declared finite owner for work that has no foreground task. Never a child fallback. */
export function independentProviderBudget(owner:string, signal?:AbortSignal, timeoutMs=180_000):{budget:TaskProviderBudget;close():void} {
  const lease=new TaskLease({owner,goal:owner,scope:{owner,audience:'system'},capabilities:[],readSet:[],signal,
    budget:{deadlineAt:Date.now()+timeoutMs,remainingInputTokens:1_000_000,remainingOutputTokens:65_536,remainingCostUsd:10,remainingActions:16}});
  return {budget:createTaskProviderBudget(lease),close:()=>lease.close()};
}

/** Child side of Node's private IPC channel, installed only by the host reader extension. */
export function installChildProviderBudget(pi:any, enabled:boolean, outputLimit?:number):void {
  if(!enabled)return;
  if(!process.send)throw new ContractError('provider_budget_channel_missing');
  let sequence=0;const outstanding:number[]=[];
  const waiting=new Map<number,{resolve:()=>void;reject:(error:Error)=>void}>();
  process.on('message',(message:any)=>{if(message?.type!=='coc-provider-grant')return;const waiter=waiting.get(message.id);if(!waiter)return;
    waiting.delete(message.id);if(message.ok&&!waiting.size)process.channel?.unref();message.ok?waiter.resolve():waiter.reject(new ContractError(message.error??'provider_budget_refused'));});
  process.channel?.unref();
  process.on('disconnect',()=>{for(const waiter of waiting.values())waiter.reject(new ContractError('provider_budget_channel_closed'));waiting.clear();});
  pi.on('before_provider_request',async(event:any,ctx:any)=>{
    try {
      const prepared=boundProviderRequest(ctx.model,event.payload,...(outputLimit&&Number.isSafeInteger(outputLimit)&&outputLimit>0?[outputLimit]:[])),id=++sequence;
      await new Promise<void>((resolve,reject)=>{process.channel?.ref();waiting.set(id,{resolve,reject});process.send!({type:'coc-provider-reserve',id,bound:prepared.bound},error=>{if(error){waiting.delete(id);reject(error);}});});
      outstanding.push(id);return prepared.payload;
    }catch(error){
      process.send?.({type:'coc-provider-failure',error:String(error)});ctx.abort();
      // ExtensionRunner logs thrown hook errors and continues. Stay pending until the owning
      // host kills this refused child, so no adapter can dispatch the unchanged payload.
      return await new Promise(()=>{});
    }
  });
  pi.on('message_end',(event:any)=>{
    if(event.message?.role!=='assistant')return;
    const ids=outstanding.splice(0);
    for(const [index,id] of ids.entries())process.send?.({type:'coc-provider-settle',id,
      ...(index===ids.length-1&&!['error','aborted'].includes(event.message.stopReason)?{usage:event.message.usage}:{})});
  });
}
