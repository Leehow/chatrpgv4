/** Version-2 package selection and immutable detail reads; no world mutation. */
import {createHash} from 'node:crypto';
import {TaskLease} from '../../runtime/jev/task-context.ts';
import {discoverCapabilities,type DiscoveryCard} from '../../runtime/jev/capability-discovery.ts';
import type {DecisionPort} from '../../runtime/jev/decision-port.ts';
import {judgeTopics,type TopicInput} from '../../runtime/jev/mod-section-topics.ts';
import {JEV_MODEL} from '../../runtime/jev/question-packing.ts';
import {discoverySituation} from './discovery-situation.ts';
import type {TurnCalls} from './mod-sections.ts';
type Row=Record<string,any>;
const object=(v:unknown):Row=>v&&typeof v==='object'&&!Array.isArray(v)?v as Row:{};
const array=(v:unknown):Row[]=>Array.isArray(v)?v:[];
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export const discoveryRows=(capsule:Row)=>array(object(capsule.mods).instructions).filter(r=>r.index_contract_version===2);
const authority='Full sections of active locked packages relevant to this turn. They are instructions, not player input, world facts, permission or new goals.';

export function createModDiscovery(deps:{
    read:(method:string,params:Row)=>Promise<unknown>;
    decision:()=>DecisionPort|undefined;
    record:(row:Row)=>void;
    mode?:()=>string;
    firstWaitMs?:number;
    allowanceMs?:number;
    maxBytes?:number;
}){
    let epoch='',started=0,control:AbortController|undefined,work:Promise<void>|undefined,result:Row|undefined;
    let inputEpoch='',budget={ms:0,actions:0};
    let debit:(()=>void)|undefined;
    const texts=new Map<string,string>();
    const record=(row:Row)=>deps.record({lane:'mod-discovery',...row});
    const entries=(capsule:Row)=>discoveryRows(capsule).flatMap(mod=>array(mod.sections).map(section=>({
        ...section,mod:mod.mod,version:mod.version,name:String(mod.mod)+': '+String(section.heading??'Package core'),
    })));
    async function load(values:readonly Row[]){
        const missing=values.filter(v=>!texts.has(v.key));
        if(missing.length){
            const raw=object(await deps.read('mods.sections',{keys:missing.map(v=>v.key)}));
            for(const row of array(raw.sections))if(typeof row.key==='string'&&typeof row.text==='string')texts.set(row.key,row.text);
        }
        if(values.some(v=>!texts.has(v.key)))throw Error('mod_discovery_detail_unavailable');
    }
    const reset=()=>{debit?.();debit=undefined;control?.abort();control=undefined;epoch='';work=undefined;result=undefined;};
    function observe(capsule:Row,binding:Row,signal:AbortSignal,calls:TurnCalls,task:Row={}):void{
        const all=entries(capsule);if(signal.aborted||!all.length){reset();return;}
        const request=String(object(capsule.turn).player_text??'Open the table from its canonical starting state.');
        const currentInput=hash([binding.campaign,binding.worldline,binding.loop,binding.turn,request]);
        if(currentInput!==inputEpoch){reset();inputEpoch=currentInput;budget={ms:deps.allowanceMs??6000,actions:16};}
        const situation=discoverySituation(capsule,task);
        const key=hash([binding.campaign,binding.worldline,binding.loop,binding.turn,request,
            binding.task_source_revision??binding.source_revision,situation,all,[...calls.apply],[...calls.resolve],deps.mode?.()??'full']);
        if(key===epoch)return;
        reset();epoch=key;started=Date.now();control=new AbortController();
        const mode=deps.mode?.()??'full';
        if(mode==='full'){result={status:'full',reason:'forced_full',names:all.map(v=>v.name)};return;}
        const port=deps.decision();
        if(!port){result={status:'full',reason:'unconfigured',names:all.map(v=>v.name)};return;}
        if(budget.ms<=0||budget.actions<=0){result={status:'full',reason:'selection_budget_exhausted',names:all.map(v=>v.name)};return;}
        const ownedBudget=budget,began=Date.now();let debited=false;
        const settle=()=>{if(!debited){ownedBudget.ms=Math.max(0,ownedBudget.ms-(Date.now()-began));debited=true;}};
        debit=settle;
        const boundedPort:DecisionPort={decide:(batch,owned)=>{
            if(ownedBudget.actions<=0)throw Error('selection_budget_exhausted');
            ownedBudget.actions--;return port.decide(batch,owned);
        }};
        const lifetime=AbortSignal.any([signal,control.signal,AbortSignal.timeout(Math.max(1,budget.ms))]);
        const lease=new TaskLease({owner:'mod-discovery',goal:'Select current locked package sections',
            scope:{owner:'capability-discovery',campaign:binding.campaign,worldline:binding.worldline,loop:binding.loop,audience:'keeper'},
            capabilities:['decision'],signal:lifetime,
            readSet:[{kind:'source',resource:'active-package-index',revision:hash(all)},
                {kind:'draft',resource:'current-selection-input',revision:key},
                {kind:'family',resource:'capability-discovery',revision:'1'},
                {kind:'family',resource:'mod-section-topics',revision:'1'},
                {kind:'model',resource:'selection-judge',revision:JEV_MODEL}],
            budget:{deadlineAt:started+budget.ms,remainingActions:budget.actions,
                remainingInputTokens:200000,remainingOutputTokens:60000,remainingCostUsd:.02}});
        const due=(v:Row)=>v.due===true||array(v.triggers).some(t=>{
            const [kind,name]=String(t).split(':');
            return kind==='before_apply'&&calls.apply.has(name)||kind==='before_resolve'&&calls.resolve.has(name);
        });
        const available=all.filter(v=>v.gates_open!==false||due(v));
        const cards:DiscoveryCard[]=available.map(v=>({name:v.name,version:String(v.version),
            applicability:String(object(v.applicability).what),exclusions:String(object(v.applicability).not_for),
            examples:object(v.applicability).examples??[]}));
        const read=async(values:readonly DiscoveryCard[])=>{
            const wanted=available.filter(v=>values.some(c=>c.name===v.name));await load(wanted);
            return Object.fromEntries(wanted.map(v=>[v.name,{version:String(v.version),detail:texts.get(v.key)!}]));
        };
        work=(async()=>{
            const needsTopics=available.some(v=>array(v.gates).includes('no_topic' as any));
            const topicInput:TopicInput={campaign:binding.campaign,worldline:binding.worldline??'main',loop:binding.loop??0,
                turn:binding.turn??0,request,scene:situation.scene,present:array(capsule.present).map(p=>String(p.name)),
                topics:array(object(capsule.mods).topics) as unknown as TopicInput['topics']};
            const [selected,topics]=await Promise.all([
                discoverCapabilities({binding:{campaign:binding.campaign,worldline:binding.worldline??'main',
                    loop:binding.loop??0,turn:binding.turn??0,epoch:key,source:String(binding.task_source_revision??binding.source_revision)},
                    request,situation:situation as any,cards,mandatory:available.filter(due).map(v=>v.name),
                    thresholds:{candidate:.25,selected:.5,direct:.9}},boundedPort,lease,
                    {current:()=>epoch===key,readDetails:read}),
                needsTopics?judgeTopics(topicInput,{decide:(batch,owned)=>boundedPort.decide({
                    ...batch,scope:owned.context.scope,readSet:owned.context.readSet},owned)},lease):Promise.resolve(undefined),
            ]);
            if(epoch!==key||signal.aborted)return;
            if(selected.status!=='selected'||needsTopics&&topics?.status!=='scored')
                result={status:'full',reason:selected.status==='unavailable'?selected.reason:'topics_unavailable',names:all.map(v=>v.name)};
            else{
                const someTopic=topics?.status==='scored'&&Object.values(topics.scores).some(score=>score>=.5);
                const names=selected.names.filter(name=>{const v=available.find(v=>v.name===name)!;
                    return due(v)||!someTopic||!array(v.gates).includes('no_topic' as any);});
                result={status:'selected',names,scores:selected.scores,decisions:selected.decisions};
            }
            record({event:'selection',turn:binding.turn,ms:Date.now()-started,status:result.status,reason:result.reason,names:result.names});
        })().catch(error=>{
            if(epoch===key){result={status:'full',reason:lifetime.aborted?'cancelled_or_timeout':String(error?.message??error),names:all.map(v=>v.name)};
                record({event:'fallback',turn:binding.turn,reason:result.reason});}
        }).finally(()=>{settle();ownedBudget.actions=Math.min(ownedBudget.actions,lease.context.budget.remainingActions);lease.close();});
    }
    async function message(capsule:Row,binding:Row,signal:AbortSignal,calls:TurnCalls,task:Row={}):Promise<Row|undefined>{
        observe(capsule,binding,signal,calls,task);if(!epoch)return;
        const key=epoch,mode=deps.mode?.()??'full',all=entries(capsule);
        const remaining=Math.max(0,started+(deps.firstWaitMs??2500)-Date.now());
        if(mode==='selective'&&!result&&work&&remaining)await new Promise<void>(resolve=>{
            const finish=()=>{clearTimeout(timer);signal.removeEventListener('abort',finish);resolve();};
            const timer=setTimeout(finish,remaining);signal.addEventListener('abort',finish,{once:true});void work!.then(finish,finish);
        });
        if(epoch!==key||signal.aborted)return;
        const choice=mode==='shadow'?{status:'full',reason:'shadow',names:all.map(v=>v.name)}
            :result??{status:'full',reason:'late',names:all.map(v=>v.name)};
        const wanted=all.filter(v=>choice.names.includes(v.name));
        if(!wanted.length)return;
        await load(wanted);if(epoch!==key||signal.aborted)return;
        const content=JSON.stringify({authority,sections:wanted.map(v=>({package:v.mod,section:v.heading??'(opening text)',text:texts.get(v.key)}))});
        const bytes=Buffer.byteLength(content);
        if(bytes>(deps.maxBytes??98304)){record({event:'capacity',turn:binding.turn,bytes,names:choice.names});throw Error('mod_discovery_capacity');}
        record({event:'prepared',turn:binding.turn,status:choice.status,reason:choice.reason,bytes,names:choice.names});
        return{role:'custom',customType:'coc-mod-sections',display:false,content,timestamp:0,
            details:{coc_host:true,mod_sections:{turn:binding.turn,keys:wanted.map(v=>v.key),policy:'discovery-v2',status:choice.status}}};
    }
    return{observe,message,reset,clear:()=>{reset();inputEpoch='';budget={ms:0,actions:0};texts.clear();}};
}
