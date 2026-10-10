/** Input-bound model visibility and read-only expansion; canonical dispatch remains the owner. */
import {createHash} from 'node:crypto';
import {TaskLease} from '../../runtime/jev/task-context.ts';
import {discoverCapabilities} from '../../runtime/jev/capability-discovery.ts';
import type {DecisionPort} from '../../runtime/jev/decision-port.ts';
import {capabilityCatalogue,projectCapabilityTools,missingEffectCapabilities,type CapabilityTool} from './capability-catalogue.ts';
import {discoverySituation} from './discovery-situation.ts';
type Row=Record<string,any>;
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const CORE=['look','lookup','ask','narrate'];
const MANDATORY=['look','ask','narrate'];
export function createCapabilityRuntime(deps:{
    tools:()=>readonly CapabilityTool[];
    decision:()=>DecisionPort|undefined;
    mode:()=>string;
    record:(row:Row)=>void;
}){
    let key='',binding:Row={},capsule:Row={},signal:AbortSignal=new AbortController().signal;
    let work:Promise<void>|undefined,control:AbortController|undefined,started=0;
    let selected:Set<string>|undefined,reason='not_prepared';
    let budget={actions:16,ms:6000},input='',spent:(()=>void)|undefined;
    const expansions=new Set<string>();
    const record=(v:Row)=>deps.record({lane:'capability-discovery',...v});
    const clear=()=>{spent?.();spent=undefined;control?.abort();key='';work=undefined;selected=undefined;expansions.clear();};
    const makeInput=(request:string)=>({
        binding:{campaign:String(binding.campaign),worldline:String(binding.worldline??'main'),
            loop:Number(binding.loop??0),turn:Number(binding.turn??0),epoch:key,
            source:String(binding.task_source_revision??binding.source_revision)},
        request,situation:discoverySituation(capsule) as any,
        cards:capabilityCatalogue(deps.tools()),mandatory:MANDATORY,
        thresholds:{candidate:.25,selected:.5,direct:.9},
    });
    async function decide(request:string){
        const port=deps.decision();if(!port)throw Error('unconfigured');
        if(budget.ms<=0||budget.actions<=0)throw Error('selection_budget_exhausted');
        const currentKey=key,ownedBudget=budget,began=Date.now();let done=false;
        const settle=()=>{if(!done){ownedBudget.ms=Math.max(0,ownedBudget.ms-(Date.now()-began));done=true;}};
        spent=settle;
        const lifetime=AbortSignal.any([signal,control!.signal,AbortSignal.timeout(Math.max(1,budget.ms))]);
        const query=makeInput(request);
        const lease=new TaskLease({owner:'capability-discovery',goal:'Select current request schema fragments',
            scope:{owner:'capability-discovery',campaign:query.binding.campaign,worldline:query.binding.worldline,
                loop:query.binding.loop,audience:'keeper'},capabilities:['decision'],signal:lifetime,
            readSet:[{kind:'source',resource:'capability-catalogue',revision:hash(query.cards)},
                {kind:'draft',resource:'current-input',revision:hash(query)}],
            budget:{deadlineAt:began+budget.ms,remainingActions:budget.actions,remainingInputTokens:200000,
                remainingOutputTokens:60000,remainingCostUsd:.02}});
        try{
            const result=await discoverCapabilities(query,{decide:(batch,owned)=>{
                if(ownedBudget.actions<=0)throw Error('selection_budget_exhausted');
                ownedBudget.actions--;return port.decide(batch,owned);
            }},lease,{current:()=>key===currentKey});
            if(result.status!=='selected')throw Error(result.reason);
            return result;
        }finally{settle();ownedBudget.actions=Math.min(ownedBudget.actions,lease.context.budget.remainingActions);lease.close();}
    }
    function observe(view:Row,context:Row,lifetime:AbortSignal){
        const nextInput=hash([context.campaign,context.worldline,context.loop,context.turn,view.turn?.player_text]);
        if(nextInput!==input){clear();input=nextInput;budget={actions:16,ms:6000};}
        const next=hash([nextInput,context.task_source_revision??context.source_revision,view.where,view.present,deps.mode()]);
        if(next===key)return;
        clear();key=next;binding=context;capsule=view;signal=lifetime;control=new AbortController();started=Date.now();
        reason='forced_full';
        if(deps.mode()==='full')return;
        const current=key;
        work=decide(String(view.turn?.player_text??'Open the canonical table.')).then(result=>{
            if(key!==current||signal.aborted)return;
            selected=new Set([...MANDATORY,...result.names]);reason='selected';
            record({event:'selected',turn:binding.turn,names:[...selected],ms:Date.now()-started});
        }).catch(error=>{
            if(key===current){reason=String(error?.message??error);record({event:'fallback',turn:binding.turn,reason});}
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
        if(!key)return;
        if(deps.mode()!=='selective'||!selected){record({event:'view',turn:binding.turn,status:'full',reason});return;}
        const available=new Set(capabilityCatalogue(tools).map(c=>c.name));
        const names=new Set([...selected,...required].filter(name=>available.has(name)));
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
    function readiness(tool:string,args:Row):Row|undefined{
        if(tool!=='apply'||deps.mode()!=='selective'||!selected)return;
        const missing=missingEffectCapabilities(Array.isArray(args.effects)?args.effects:[],deps.tools(),selected);
        if(!missing.length)return;
        const request=hash([key,args.effects]);if(expansions.has(request)){selected=undefined;reason='repeated_expansion';return;}
        expansions.add(request);for(const name of missing)selected.add(name);
        record({event:'expansion',turn:binding.turn,names:missing,no_commit:true});
        return{block:true,reason:'Required capability detail has been loaded; no world change was committed. Re-decide the whole batch with the expanded schema. '+JSON.stringify({missing_capabilities:missing,no_commit:true})};
    }
    async function lookup(args:Row):Promise<Row>{
        if(!key||signal.aborted)throw Error('Capability discovery has no current input');
        const catalogue=capabilityCatalogue(deps.tools());
        let names:string[];
        if(typeof args.name==='string'){
            const found=catalogue.find(c=>c.name.toLowerCase()===args.name.trim().toLowerCase());
            if(!found)throw Error('Unknown capability name');
            names=[found.name];
        }else if(typeof args.query==='string'&&args.query.trim())names=(await decide(args.query)).names;
        else throw Error('Capability discovery requires a semantic name or purpose query');
        if(selected)for(const name of names)selected.add(name);
        return{read_only:true,capabilities:catalogue.filter(c=>names.includes(c.name)).map(c=>({
            name:c.name,applicability:c.applicability,exclusions:c.exclusions,detail:c.detail})),no_commit:true};
    }
    return{observe,wait,project,readiness,lookup,clear};
}
