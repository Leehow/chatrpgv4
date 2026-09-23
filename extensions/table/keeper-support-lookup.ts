/** Explicit Keeper retrieval through the same preparation implementation as automatic preload. */
import {createDecisionAdapter} from '../../runtime/jev/decision-adapter.ts';
import type {DecisionPort} from '../../runtime/jev/decision-port.ts';
import type {TaskProviderBudget} from '../../runtime/jev/provider-budget.ts';
import {preparationBudget,preparationProviderBudget} from '../../runtime/jev/preparation-budget.ts';
import {supportRequest,validateKeeperSupport,type KeeperSupport} from '../../runtime/jev/keeper-support-contract.ts';
import type {PrescreenSourceRuntime} from '../../runtime/jev/prescreen-source-provider.ts';
import {readJevApiKey,readJevPreselectAllowanceMs} from '../jev/agent/config.js';
import {KernelError} from '../kernel/client.ts';
import {bindingOf,object,type Row} from './context-policy.ts';
import {prepareKeeperSupport} from './prescreen.ts';

export async function lookupKeeperSupport(input:{campaign:string;query:string;call:(method:string,params:Row)=>Promise<unknown>;
    signal?:AbortSignal;record:(event:Row)=>void;parent?:TaskProviderBudget;source?:{moduleId:string;runtime:PrescreenSourceRuntime};
    env?:NodeJS.ProcessEnv;decision?:DecisionPort}):Promise<KeeperSupport> {
    if(typeof input.query!=='string'||!input.query.trim()||input.query.length>2048)throw new KernelError({code:'invalid_params',message:'Support lookup needs a nonempty query of at most 2048 characters'});
    const env=input.env??process.env;
    if(!readJevApiKey(env))throw new KernelError({code:'needs',message:'Jev support lookup is unavailable',
        fix:'Use direct lookup or recall for the missing evidence.',details:{reason:'support_not_configured'}});
    const deadlineAt=Math.min(Date.now()+readJevPreselectAllowanceMs(env),input.parent?.deadlineAt??Infinity),remaining=deadlineAt-Date.now();
    if(remaining<=0)throw new KernelError({code:'needs',message:'The support lookup allowance is exhausted',details:{reason:'support_budget_exhausted'}});
    const signal=AbortSignal.any([AbortSignal.timeout(Math.max(1,remaining)),...(input.signal?[input.signal]:[]),...(input.parent?[input.parent.signal]:[])]);
    const call=async(method:string,params:Row):Promise<unknown>=>{
        signal.throwIfAborted();let abort=()=>{};
        try{return await Promise.race([input.call(method,{...params,campaign:input.campaign}),new Promise<never>((_,reject)=>{
            abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
        })]);}finally{signal.removeEventListener('abort',abort);}
    };
    const budget=preparationBudget({campaign:input.campaign,deadlineAt,signal,parent:input.parent,
        decision:input.decision??createDecisionAdapter({env,maxConcurrency:4})});
    try{
        const {_context,...capsule}=object(await call('table.capsule',{rehydrate:true})),binding=bindingOf(_context);
        if(!binding||binding.campaign!==input.campaign)throw new KernelError({code:'needs',message:'The current support scope is unavailable',details:{reason:'support_scope_unavailable'}});
        const prepared=await prepareKeeperSupport({campaign:input.campaign,call,binding,capsule,request:supportRequest(input.query,'lookup'),
            decision:budget.decision,signal,deadlineAt,byteBudget:16*1024,source:input.source,providerBudget:preparationProviderBudget(),
            record:event=>input.record({...event,lane:'keeper-support',purpose:'lookup'})});
        signal.throwIfAborted();
        if(!prepared)throw new KernelError({code:'needs',message:'Support retrieval did not produce a current packet',
            fix:'Use direct lookup or recall for the missing evidence.',details:{reason:'support_unavailable'}});
        return validateKeeperSupport(JSON.parse(String(prepared.content)));
    }finally{budget.close();}
}
