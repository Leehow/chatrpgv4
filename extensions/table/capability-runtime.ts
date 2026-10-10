/** Input-bound model visibility and read-only expansion; canonical dispatch remains the owner. */
import {createHash} from 'node:crypto';
import {TaskLease} from '../../runtime/jev/task-context.ts';
import {discoverCapabilities} from '../../runtime/jev/capability-discovery.ts';
import type {DecisionPort} from '../../runtime/jev/decision-port.ts';
import {capabilityCatalogue,projectCapabilityTools,missingEffectCapabilities,type CapabilityTool} from './capability-catalogue.ts';
import {discoverySituation} from './discovery-situation.ts';
type Row=Record<string,any>;
/** One observed selection epoch: the bound input, source and situation a decision is asked against. */
type Epoch={key:string;input:string;binding:Row;capsule:Row;task:Row;signal:AbortSignal};
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const CORE=['look','lookup','ask','narrate'];
const MANDATORY=['look','ask','narrate'];
export function createCapabilityRuntime(deps:{
    tools:()=>readonly CapabilityTool[];
    decision:()=>DecisionPort|undefined;
    /** Contract §209.14: the Keeper's purpose lookup is asked through its foreground owner; a string names why none is live. */
    lookupDecision?:()=>DecisionPort|string;
    mode:()=>string;
    record:(row:Row)=>void;
}){
    let key='',binding:Row={},signal:AbortSignal=new AbortController().signal;
    let work:Promise<void>|undefined,control:AbortController|undefined,started=0;
    let selected:Set<string>|undefined,widenPending=false,fallbackPinned=false,reason='not_prepared';
    let budget={actions:16,ms:6000},input='',spent:(()=>void)|undefined;
    // §217.1: what the last projected request showed the Keeper. It belongs to that request, not to the selection epoch:
    // only the next projection (or the end of the input) replaces it, so a mid-batch invalidation keeps the write gate.
    let visible:Set<string>|undefined;
    // §217.1: the input's lookup basis -- the last epoch observed for the still-current player input. An in-input
    // invalidation (source publication, failed snapshot check) drops the view but keeps the basis, so the Keeper's lookups,
    // issued from a request of this input, still answer. Only `clear()` (new input, session reset) ends it.
    let basis:Epoch|undefined,lookups=new AbortController(),pinned:string|undefined;
    /** §217.1: names this input's lookups and expansions loaded; every later selected view of the same input shows them. */
    const carried=new Set<string>();
    const expansions=new Set<string>();
    const queries=new Map<string,ReturnType<typeof decide>>();
    const record=(v:Row)=>deps.record({lane:'capability-discovery',...v});
    /** Drop the selected view and its in-flight selection; the input's basis, its lookups and the last request's view stay. */
    const drop=()=>{spent?.();spent=undefined;control?.abort();key='';work=undefined;selected=undefined;fallbackPinned=false;};
    const invalidate=()=>{drop();};
    const clear=()=>{drop();basis=undefined;lookups.abort();lookups=new AbortController();pinned=undefined;carried.clear();
        visible=undefined;widenPending=false;expansions.clear();queries.clear();};
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
        // §217.1: an input widened by a failed lookup or a repeated expansion stays widened for every later epoch of it.
        if(pinned){fallbackPinned=true;reason=pinned;return;}
        if(deps.mode()==='full')return;
        work=cachedDecision(String(view.turn?.player_text??'Open the canonical table.'),epoch,'view').then(result=>{
            if(key!==epoch.key||signal.aborted||fallbackPinned)return;
            selected=new Set([...MANDATORY,...result.names,...carried]);reason='selected';
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
    function project(tools:readonly CapabilityTool[],required:readonly string[]=[]):CapabilityTool[]|undefined{
        // §217.1: every request replaces what the previous one showed; a full view shows everything and lifts the widen hold.
        if(!key){visible=undefined;widenPending=false;return;}
        if(deps.mode()!=='selective'||!selected){visible=undefined;widenPending=false;record({event:'view',turn:binding.turn,status:'full',reason});return;}
        const available=new Set(capabilityCatalogue(tools).map(c=>c.name));
        const names=new Set([...selected,...required].filter(name=>available.has(name)));
        visible=names;
        const view=projectCapabilityTools(tools,names,CORE);
        // Discovery itself remains available even when ordinary lookup was not selected.
        const lookup=view.find(t=>t.name==='lookup');
        if(lookup&&!names.has('lookup')){
            const keep=['kind','name','query'];lookup.parameters.properties=Object.fromEntries(
                Object.entries(lookup.parameters.properties).filter(([name])=>keep.includes(name)));
            lookup.parameters.properties.kind={type:'string',enum:['capability']};
            lookup.description='Read-only capability discovery. Use kind capability and a semantic name or purpose query to load missing tool detail. This never authorizes or commits a world change.';
        }
        record({event:'view',turn:binding.turn,status:'selected',names:[...names],
            schema_bytes:Buffer.byteLength(JSON.stringify(view))});
        return view;
    }
    /** §217.1: widen the current input to the full view and hold writes until a full request is projected. */
    function widen(why:string){selected=undefined;visible=undefined;widenPending=true;fallbackPinned=true;reason=why;pinned=why;}
    function readiness(tool:string,args:Row):Row|undefined{
        if(tool==='apply'&&widenPending){record({event:'held',turn:binding.turn,reason:'widen_pending',no_commit:true});return{block:true,reason:'A full capability view is required before retrying this whole batch; no world change was committed.'};}
        // §217.1: the gate reads what the request the Keeper decided from actually showed (`visible`), so an invalidation
        // between that request and this call (a source publication mid-batch) cannot open it.
        if(tool!=='apply'||deps.mode()!=='selective'||!visible)return;
        const missing=missingEffectCapabilities(Array.isArray(args.effects)?args.effects:[],deps.tools(),visible);
        if(!missing.length)return;
        const request=hash([input,args.effects]);if(expansions.has(request)){
            widen('repeated_expansion');
            record({event:'fallback',turn:binding.turn,reason:'repeated_expansion',no_commit:true});
            return{block:true,reason:'Capability expansion was not shown before this retry. Read the next full request and re-decide the whole batch; no world change was committed.'};
        }
        expansions.add(request);for(const name of missing){carried.add(name);selected?.add(name);}
        record({event:'expansion',turn:binding.turn,names:missing,no_commit:true});
        return{block:true,reason:'Required capability detail has been loaded; no world change was committed. Re-decide the whole batch with the expanded schema. '+JSON.stringify({
            status:'expansion',requested:missing,loaded:missing,missing_capability:missing,no_commit:true})};
    }
    async function lookup(args:Row):Promise<Row>{
        const epoch=basis;
        if(!epoch||epoch.signal.aborted)throw Error('Capability discovery has no current input');
        // §217.1: a lookup answers for its input; a later epoch of the same input (a source publication, a write) does not
        // replace it, a new input or the end of the input's lifetime does.
        const live=()=>basis?.input===epoch.input&&!epoch.signal.aborted;
        const catalogue=capabilityCatalogue(deps.tools());
        let names:string[];
        if(typeof args.name==='string'){
            const found=catalogue.find(c=>c.name.toLowerCase()===args.name.trim().toLowerCase());
            if(!found)throw Error('Unknown capability name');
            names=[found.name];
        }else if(typeof args.query==='string'&&args.query.trim()){
            try{names=(await cachedDecision(args.query,epoch,'lookup',deps.lookupDecision??deps.decision)).names;}
            catch(error){
                if(!live())throw Error('Capability lookup input was replaced or cancelled');
                const why=String(error?.message??error).slice(0,160);
                widen(why);
                record({event:'lookup_fallback',turn:binding.turn,reason:why,no_commit:true});
                return{status:'full_fallback',read_only:true,capabilities:[],reason:why,no_commit:true,
                    next:'Read the next full canonical request and re-decide. This result performs no write.'};
            }
        }
        else throw Error('Capability discovery requires a semantic name or purpose query');
        if(!live())throw Error('Capability lookup input was replaced or cancelled');
        for(const name of names){carried.add(name);selected?.add(name);}
        return{read_only:true,capabilities:catalogue.filter(c=>names.includes(c.name)).map(c=>({
            name:c.name,applicability:c.applicability,exclusions:c.exclusions,detail:c.detail})),no_commit:true};
    }
    return{observe,wait,project,readiness,lookup,invalidate,clear};
}
