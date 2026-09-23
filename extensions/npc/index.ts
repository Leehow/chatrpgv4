/** Core NPC preparation after delivery. No public tool and no foreground authoring barrier. */
import type {ExtensionAPI} from '@earendil-works/pi-coding-agent';
import {randomUUID} from 'node:crypto';
import type {HostRuntime} from '../../runtime/host.ts';
import {cocMode} from '../lanes/host.ts';
import {createLaneQueue,type LaneJob} from '../lanes/queue.ts';
import {resolveLaneModel} from '../lanes/subsession.ts';
import {createLaneTelemetry} from '../lanes/telemetry.ts';
import {authorNpc} from './writer.ts';
import {createDecisionAdapter} from '../../runtime/jev/decision-adapter.ts';
import type {DecisionPort} from '../../runtime/jev/decision-port.ts';
import type {TaskProviderBudget} from '../../runtime/jev/provider-budget.ts';
import {evaluateNpcResponses} from '../../runtime/jev/npc-responses.ts';
import {readJevApiKey} from '../jev/agent/config.js';

const object=(value:unknown):Record<string,any>=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,any>:{};
export default function npcExtension(pi:ExtensionAPI):void {
    if(cocMode()!=='play')return;
    let runtime:HostRuntime|undefined;
    let decision:DecisionPort|undefined;
    let adviceEpoch=0,adviceSession='',adviceValid=false,adviceWork:AbortController|undefined;
    let foregroundBudget:(()=>TaskProviderBudget|undefined)|undefined;
    const refreshRequested=new Set<string>(),lastRefresh=new Map<string,string>();
    const attempted=new Set<string>();
    pi.events.on('coc:kernel-bridge',data=>{
        adviceWork?.abort();adviceValid=false;adviceEpoch++;
        runtime=(data as {runtime?:HostRuntime}|undefined)?.runtime;
    });
    pi.events.on('coc:task-provider-budget',value=>{foregroundBudget=typeof value==='function'?value as typeof foregroundBudget:undefined;});
    let automaticInput:string|undefined;
    pi.on('session_start',async()=>{
        adviceWork?.abort();adviceValid=false;adviceEpoch++;automaticInput=undefined;refreshRequested.clear();lastRefresh.clear();
        adviceSession=randomUUID();
        attempted.clear();const env={...process.env},capacity=Number(env.PI_COC_JEV_CONCURRENCY??16);
        decision=readJevApiKey(env)?createDecisionAdapter({env,maxConcurrency:Number.isInteger(capacity)&&capacity>0?Math.min(capacity,16):16}):undefined;
        pi.events.emit('coc:npc-bridge',{evaluate});
    });
    pi.on('session_shutdown',async()=>{adviceWork?.abort();adviceValid=false;decision=undefined;pi.events.emit('coc:npc-bridge',undefined);});
    pi.on('before_agent_start',async()=>{
        adviceWork?.abort();const epoch=++adviceEpoch;adviceValid=false;
        const bridge=scheduler.bridge;
        if(!bridge||!decision||process.env.PI_COC_NPC_ADVICE_AUTO==='0')return;
        const owner=new AbortController();adviceWork=owner;
        const configured=Number(process.env.PI_COC_NPC_ADVICE_WAIT_MS??1250);
        const milliseconds=Number.isFinite(configured)&&configured>=0?Math.min(configured,2000):1250;
        if(milliseconds===0)return;
        const ready:unknown[]=[];let timer:ReturnType<typeof setTimeout>|undefined;
        try{
            const work=evaluate({campaign:bridge.campaign,signal:owner.signal,deadlineAt:Date.now()+milliseconds,automatic:true,providerBudget:foregroundBudget?.(),
                onResult:row=>{if(epoch===adviceEpoch&&!owner.signal.aborted&&row.status==='ready')ready.push({npc:row.npc,selected:row.selected});}}).catch(()=>undefined);
            await Promise.race([work,new Promise<void>(resolve=>{timer=setTimeout(resolve,milliseconds);})]);
        }catch{/* Optional context cannot prevent the Keeper request. */}finally{clearTimeout(timer);owner.abort();}
        if(!ready.length||epoch!==adviceEpoch||scheduler.stopped)return;
        const packet={kind:'npc_response_advice',advice:[] as unknown[],omitted:0,note:'Optional suggestions grounded in the current input and each person\'s limited perspective. The Keeper may choose otherwise. Do not manufacture a new player choice, require every NPC to act, or describe an unexecuted effect. Ordinary direct answers and natural closure remain valid.'};
        for(const row of ready){if(Buffer.byteLength(JSON.stringify({...packet,advice:[...packet.advice,row]}))<=4096)packet.advice.push(row);else packet.omitted++;}
        if(!packet.advice.length)return;
        const content=JSON.stringify(packet);
        adviceValid=true;
        return {message:{customType:'coc-npc-advice',content,display:false,details:{epoch,session:adviceSession}}};
    });
    pi.on('tool_result',event=>{if(['look','lookup','recall','resolve','apply','narrate','ask'].includes(event.toolName)){adviceValid=false;adviceWork?.abort();}});
    pi.on('context',event=>({messages:event.messages.filter(message=>message.role!=='custom'||message.customType!=='coc-npc-advice'
        ||adviceValid&&object(message.details).epoch===adviceEpoch&&object(message.details).session===adviceSession)}));
    const {record}=createLaneTelemetry(pi,{lane:'npc',modelEnv:'PI_COC_NPC_MODEL',cwd:()=>scheduler.ctx?.cwd});
    const scheduler=createLaneQueue(pi,{backfillEnv:'PI_COC_NPC_BACKFILL',backfillDefault:1,runJob,onError:async(job)=>{
        await record(job.campaign,{ok:false,reason:'npc_preparation_unavailable'});
    }});
    async function runJob(job:LaneJob):Promise<void>{
        const bridge=scheduler.bridge,ctx=scheduler.ctx,host=runtime,signal=scheduler.signal;
        if(!bridge||!ctx||!host||scheduler.stopped)return;
        const model=resolveLaneModel(ctx,'PI_COC_NPC_MODEL');
        if(!model.ok){await record(job.campaign,{ok:false,reason:'model_unavailable'});return;}
        const view=object(await bridge.call('table.look',{campaign:job.campaign,focus:'npc'}));
        const names=[...new Set((Array.isArray(view.present)?view.present:[]).flatMap(value=>{
            const row=object(value);return typeof row.name==='string'?[row.name]:[];
        }))] as string[];
        let next=0;
        // Author concurrency is separate from the shared Jev decision capacity. Independent authors
        // never own the campaign writer lock while their tool-enabled model task is running.
        const configured=Number(process.env.PI_COC_NPC_AUTHORS??2);
        const concurrency=Number.isInteger(configured)&&configured>0?Math.min(configured,8):2;
        await Promise.all(Array.from({length:Math.min(concurrency,names.length)},async()=>{
            while(next<names.length&&!scheduler.stopped&&!signal.aborted){
                const name=names[next++];
                for(const kind of decision?['personality','responses']:['personality']){
                let id:string|undefined,claim:string|undefined;
                try {
                    const packet=object(await bridge.call(kind==='personality'?'npc.job':'npc.responses.job',{campaign:job.campaign,name,...(kind==='responses'&&refreshRequested.has(name)?{refresh:true}:{})}));
                    id=typeof packet.job_id==='string'?packet.job_id:undefined;
                    claim=typeof packet.claim==='string'?packet.claim:undefined;
                    const attempt=JSON.stringify([id,claim]);
                    if(!id||attempted.has(attempt))continue;
                    if(kind==='responses')refreshRequested.delete(name);
                    attempted.add(attempt);
                    const draft=object(await authorNpc({runtime:host,jobId:id,model:`${model.model.provider}/${model.model.id}`,pinned:model.source==='operator',
                        instruction:String(packet.instruction??''),input:{npc:packet.npc},signal}));
                    if(scheduler.stopped||signal.aborted||scheduler.bridge!==bridge)return;
                    await bridge.call(kind==='personality'?'npc.submit':'npc.responses.submit',{campaign:job.campaign,job_id:id,claim,[kind]:draft[kind]});
                    await record(job.campaign,{ok:true,kind,npc:name});
                } catch {
                    if(id&&!signal.aborted&&scheduler.bridge===bridge)await bridge.call('npc.fail',{campaign:job.campaign,job_id:id,claim,reason:'author_unavailable'}).catch(()=>undefined);
                    await record(job.campaign,{ok:false,kind,npc:name,reason:signal.aborted?'cancelled':'author_unavailable'});
                }
                }
            }
        }));
    }
    async function evaluate(request:{campaign:string;name?:string;signal?:AbortSignal;providerBudget?:TaskProviderBudget;deadlineAt?:number;automatic?:boolean;onResult?:(row:import('../../runtime/jev/npc-responses.ts').NpcResponseAdvice)=>void}):Promise<Record<string,unknown>>{
        const bridge=scheduler.bridge,port=decision;
        if(!bridge||bridge.campaign!==request.campaign)return {status:'unavailable',reason:'campaign_binding_changed'};
        if(!port)return {status:'unavailable',reason:'jev_unconfigured'};
        const signal=request.signal?AbortSignal.any([request.signal,scheduler.signal]):scheduler.signal;
        signal.throwIfAborted();
        const group=object(await bridge.call('npc.perspectives',{campaign:request.campaign,...(request.name?{name:request.name}:{})}));
        const snapshots=(Array.isArray(group.views)?group.views:[]).map(object);
        const read=async(name:string)=>object(await bridge.call('npc.perspective',{campaign:request.campaign,name}));
        signal.throwIfAborted();
        const input=snapshots[0]?.input;
        const key=JSON.stringify([request.campaign,snapshots[0]?.scope,input?.turn,input?.player_input]);
        if(request.automatic){
            if(typeof input?.player_input!=='string'||!input.player_input.trim())return {status:'unavailable',reason:'no_player_input'};
            if(automaticInput===key)return {status:'unavailable',reason:'already_prepared_for_input'};
            automaticInput=key;
        }
        const advice=await evaluateNpcResponses({campaign:request.campaign,snapshots,decision:port,signal,current:read,providerBudget:request.providerBudget,deadlineAt:request.deadlineAt,onResult:request.onResult,includeScores:!request.automatic,
            onUsage:row=>{void record(request.campaign,{kind:'decision',...row});}});
        for(const row of advice)void record(request.campaign,{kind:'advice',...row});
        for(const row of advice)if(!signal.aborted&&scheduler.bridge===bridge&&row.status==='unresolved'&&lastRefresh.get(row.npc)!==key){
            lastRefresh.set(row.npc,key);refreshRequested.add(row.npc);
        }
        return {status:advice.every(row=>row.status==='ready')?'ready':'partial',advice,
            note:'Advisory response intentions only. Preserve player decisions, source truth and canonical effect receipts. Use your own response when no suggestion fits.'};
    }
}
