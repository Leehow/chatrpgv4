/** Input-bound disclosure of apply capability detail over a fixed tool view; canonical dispatch remains the owner. */
import {createHash} from 'node:crypto';
import {TaskLease} from '../../runtime/jev/task-context.ts';
import {discoverCapabilities} from '../../runtime/jev/capability-discovery.ts';
import type {DecisionPort} from '../../runtime/jev/decision-port.ts';
import {capabilityCatalogue,fixedCapabilityTools,missingEffectCapabilities,type CapabilityTool} from './capability-catalogue.ts';
import {discoverySituation} from './discovery-situation.ts';
type Row=Record<string,any>;
/** One observed selection epoch: the bound input, source and situation a decision is asked against. */
type Epoch={key:string;input:string;binding:Row;capsule:Row;task:Row;signal:AbortSignal};
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const MANDATORY=['look','ask','narrate','output'];
export function createCapabilityRuntime(deps:{
    tools:()=>readonly CapabilityTool[];
    decision:()=>DecisionPort|undefined;
    /** Contract §209.14: the Keeper's purpose lookup is asked through its foreground owner; a string names why none is live. */
    lookupDecision?:()=>DecisionPort|string;
    mode:()=>string;
    /** §228.1: the configured discovery mode; an input pinned to `full` decisions keeps the fixed request view. */
    view?:()=>string;
    record:(row:Row)=>void;
}){
    let key='',binding:Row={},signal:AbortSignal=new AbortController().signal;
    let work:Promise<void>|undefined,control:AbortController|undefined,started=0;
    let selected:Set<string>|undefined,reason='not_prepared';
    let budget={actions:16,ms:6000},input='',spent:(()=>void)|undefined;
    // §217.1: the input's lookup basis -- the last epoch observed for the still-current player input. An in-input
    // invalidation (source publication, failed snapshot check) drops the selection but keeps the basis, so the Keeper's
    // lookups, issued from a request of this input, still answer. Only `clear()` (new input, session reset) ends it.
    let basis:Epoch|undefined,lookups=new AbortController();
    const queries=new Map<string,ReturnType<typeof decide>>();
    const record=(v:Row)=>deps.record({lane:'capability-discovery',...v});
    const fixed=()=>(deps.view?.()??deps.mode())==='selective';
    /** Drop the selection and its in-flight decision; the input's basis and its lookups stay. */
    const drop=()=>{spent?.();spent=undefined;control?.abort();key='';work=undefined;selected=undefined;};
    const invalidate=()=>{drop();};
    const clear=()=>{drop();basis=undefined;lookups.abort();lookups=new AbortController();queries.clear();};
    const makeInput=(request:string,epoch:Epoch)=>({
        binding:{campaign:String(epoch.binding.campaign),worldline:String(epoch.binding.worldline??'main'),
            loop:Number(epoch.binding.loop??0),turn:Number(epoch.binding.turn??0),epoch:epoch.key,
            source:String(epoch.binding.task_source_revision??epoch.binding.source_revision)},
        request,situation:discoverySituation(epoch.capsule,epoch.task) as any,
        cards:capabilityCatalogue(deps.tools()),mandatory:[...MANDATORY,...taskCapabilities(epoch.task)],
        thresholds:{candidate:.25,selected:.5,direct:.9},
    });
    function taskCapabilities(task:Row):string[]{
        const effects=(Array.isArray(task.operations)?task.operations:[]).filter((op:Row)=>op.verb==='apply')
            .map((op:Row)=>({kind:op.family,...op.bound,...Object.fromEntries((op.needs??[]).map((need:Row)=>[need.name,null]))}));
        return missingEffectCapabilities(effects,deps.tools(),new Set());
    }
    function cachedDecision(request:string,epoch:Epoch,kind:'view'|'lookup',source:()=>DecisionPort|string|undefined=deps.decision){
        const queryKey=hash([epoch.key,kind,request]);
        let pending=queries.get(queryKey);
        if(!pending){pending=decide(request,epoch,kind,source);queries.set(queryKey,pending);}
        return pending;
    }
    async function decide(request:string,epoch:Epoch,kind:'view'|'lookup',source:()=>DecisionPort|string|undefined){
        const port=source();if(typeof port==='string')throw Error(port);if(!port)throw Error('unconfigured');
        if(budget.ms<=0||budget.actions<=0)throw Error('selection_budget_exhausted');
        const ownedBudget=budget,began=Date.now();let done=false;
        const settle=()=>{if(!done){ownedBudget.ms=Math.max(0,ownedBudget.ms-(Date.now()-began));done=true;}};
        // A view selection is abandoned with its epoch; a lookup lives as long as its input (§217.1) and settles itself.
        if(kind==='view')spent=settle;
        const owner=kind==='view'?control!.signal:lookups.signal;
        const lifetime=AbortSignal.any([epoch.signal,owner,AbortSignal.timeout(Math.max(1,budget.ms))]);
        const query=makeInput(request,epoch);
        const lease=new TaskLease({owner:'capability-discovery',goal:'Select current request schema fragments',
            scope:{owner:'capability-discovery',campaign:query.binding.campaign,worldline:query.binding.worldline,
                loop:query.binding.loop,audience:'keeper'},capabilities:['decision'],signal:lifetime,
            readSet:[{kind:'source',resource:'capability-catalogue',revision:hash(query.cards)},
                {kind:'draft',resource:'current-input',revision:hash(query)}],
            budget:{deadlineAt:began+budget.ms,remainingActions:budget.actions,remainingInputTokens:200000,
                remainingOutputTokens:60000,remainingCostUsd:.02}});
        const current=kind==='view'?()=>key===epoch.key:()=>basis?.input===epoch.input&&!epoch.signal.aborted;
        try{
            const result=await discoverCapabilities(query,{decide:(batch,owned)=>{
                if(ownedBudget.actions<=0)throw Error('selection_budget_exhausted');
                ownedBudget.actions--;return port.decide(batch,owned);
            }},lease,{current});
            if(result.status!=='selected')throw Error(result.reason);
            return result;
        }finally{settle();ownedBudget.actions=Math.min(ownedBudget.actions,lease.context.budget.remainingActions);lease.close();}
    }
    function observe(view:Row,context:Row,lifetime:AbortSignal,currentTask:Row={}){
        const nextInput=hash([context.campaign,context.worldline,context.loop,context.turn,view.turn?.player_text]);
        if(nextInput!==input){clear();input=nextInput;budget={actions:16,ms:6000};}
        const next=hash([nextInput,context.task_source_revision??context.source_revision,
            discoverySituation(view,currentTask),capabilityCatalogue(deps.tools()).map(c=>[c.name,c.version]),deps.mode()]);
        if(next===key)return;
        drop();key=next;binding=context;signal=lifetime;control=new AbortController();started=Date.now();
        const epoch:Epoch={key,input,binding:context,capsule:view,task:currentTask,signal:lifetime};basis=epoch;
        reason='forced_full';
        if(deps.mode()==='full')return;
        work=cachedDecision(String(view.turn?.player_text??'Open the canonical table.'),epoch,'view').then(result=>{
            if(key!==epoch.key||signal.aborted)return;
            selected=new Set(result.names);reason='selected';
            record({event:'selected',turn:binding.turn,names:[...selected],ms:Date.now()-started});
        }).catch(error=>{
            if(key===epoch.key){reason=String(error?.message??error);record({event:'fallback',turn:binding.turn,reason});}
        });
    }
    async function wait(){
        if(deps.mode()!=='selective'||!work||selected)return;
        const remaining=Math.max(0,started+2500-Date.now());
        if(!remaining)return;
        await new Promise<void>(resolve=>{const timer=setTimeout(resolve,remaining);
            void work!.then(()=>{clearTimeout(timer);resolve();});});
    }
    /** §228.1: the request's tool view is the same bytes on every request of a table; nothing is narrowed or widened. */
    function project(tools:readonly CapabilityTool[]):CapabilityTool[]|undefined{
        if(fixed())return fixedCapabilityTools(tools);
    }
    /**
     * §228.2: the apply detail this input is due: the selection, the host task's operations and the dependencies the
     * caller names (of delivered package sections). The caller's disclosure ledger sends each name once. A slow or
     * failed selection leaves the deterministic part; anything else is disclosed when first used or looked up.
     */
    function due(required:readonly string[]=[]):string[]{
        if(!fixed()||!basis)return[];
        const apply=new Set(capabilityCatalogue(deps.tools()).filter(c=>c.verb==='apply').map(c=>c.name));
        return[...new Set([...(selected??[]),...taskCapabilities(basis.task),...required].filter(name=>apply.has(name)))];
    }
    /**
     * §228.3: the capability detail a write's effects use. The call is never held for it: the canonical validator already
     * accepted the arguments; whatever of it the input has not delivered rides on this call's result.
     */
    function used(tool:string,args:Row):string[]{
        if(tool!=='apply'||!fixed())return[];
        try{return missingEffectCapabilities(Array.isArray(args.effects)?args.effects:[],deps.tools(),new Set());}
        catch{return[];}
    }
    async function lookup(args:Row):Promise<Row>{
        const epoch=basis;
        if(!epoch||epoch.signal.aborted)throw Error('Capability discovery has no current input');
        // §217.1: a lookup answers for its input; a later epoch of the same input (a source publication, a write) does not
        // replace it, a new input or the end of the input's lifetime does.
        const live=()=>basis?.input===epoch.input&&!epoch.signal.aborted;
        const catalogue=capabilityCatalogue(deps.tools());
        let names:string[];
        // A query that is exactly a capability name or effect kind is that name: it needs no decision to answer.
        const exact=typeof args.query==='string'?args.query.trim().toLowerCase():'';
        const named=exact?catalogue.filter(c=>c.verb==='apply'&&(c.name.toLowerCase()===exact||c.effect===exact)).map(c=>c.name):[];
        if(typeof args.name!=='string'&&named.length)names=named;
        else if(typeof args.name==='string'){
            const found=catalogue.find(c=>c.name.toLowerCase()===args.name.trim().toLowerCase());
            if(!found)throw Error('Unknown capability name');
            names=[found.name];
        }else if(typeof args.query==='string'&&args.query.trim()){
            try{names=(await cachedDecision(args.query,epoch,'lookup',deps.lookupDecision??deps.decision)).names;}
            catch(error){
                if(!live())throw Error('Capability lookup input was replaced or cancelled');
                const why=String(error?.message??error).slice(0,160);
                record({event:'lookup_fallback',turn:binding.turn,reason:why,no_commit:true});
                // §228.4: no wider tool view exists to fall back to; the index answers and a named lookup reads detail.
                return{status:'index_fallback',read_only:true,reason:why,no_commit:true,
                    capabilities:catalogue.filter(c=>c.verb==='apply').map(c=>({name:c.name,applicability:c.applicability})),
                    next:'Look up a capability by name for its exact fields. This result performs no write.'};
            }
        }
        else throw Error('Capability discovery requires a semantic name or purpose query');
        if(!live())throw Error('Capability lookup input was replaced or cancelled');
        return{read_only:true,capabilities:catalogue.filter(c=>names.includes(c.name)).map(c=>({
            name:c.name,applicability:c.applicability,exclusions:c.exclusions,detail:c.detail})),no_commit:true};
    }
    return{observe,wait,project,due,used,lookup,invalidate,clear};
}
