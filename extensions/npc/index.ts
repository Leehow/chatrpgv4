/**
 * Core NPC preparation after delivery: the personality author. No public tool and no foreground authoring barrier.
 *
 * Contract §139.6: the per-turn response advice (a Jev choice among a prepared bank of conditional intentions, sent to
 * the Keeper as a `coc-npc-advice` message) and the bank's own author are retired. What a person does is generated
 * from their situation (§139) and lands as receipts; what they already did is on the card (§138.3).
 */
import type {ExtensionAPI} from '@earendil-works/pi-coding-agent';
import type {HostRuntime} from '../../runtime/host.ts';
import {cocMode} from '../lanes/host.ts';
import {createLaneQueue,type LaneJob} from '../lanes/queue.ts';
import {resolveLaneModel} from '../lanes/subsession.ts';
import {createLaneTelemetry} from '../lanes/telemetry.ts';
import {authorNpc} from './writer.ts';

const object=(value:unknown):Record<string,any>=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,any>:{};
export default function npcExtension(pi:ExtensionAPI):void {
    if(cocMode()!=='play')return;
    let runtime:HostRuntime|undefined;
    const attempted=new Set<string>();
    pi.events.on('coc:kernel-bridge',data=>{runtime=(data as {runtime?:HostRuntime}|undefined)?.runtime;});
    pi.on('session_start',async()=>{attempted.clear();});
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
        // Independent authors never own the campaign writer lock while their tool-enabled model task is running.
        const configured=Number(process.env.PI_COC_NPC_AUTHORS??2);
        const concurrency=Number.isInteger(configured)&&configured>0?Math.min(configured,8):2;
        await Promise.all(Array.from({length:Math.min(concurrency,names.length)},async()=>{
            while(next<names.length&&!scheduler.stopped&&!signal.aborted){
                const name=names[next++],kind='personality';
                let id:string|undefined,claim:string|undefined;
                try {
                    const packet=object(await bridge.call('npc.job',{campaign:job.campaign,name}));
                    id=typeof packet.job_id==='string'?packet.job_id:undefined;
                    claim=typeof packet.claim==='string'?packet.claim:undefined;
                    const attempt=JSON.stringify([id,claim]);
                    if(!id||attempted.has(attempt))continue;
                    attempted.add(attempt);
                    const draft=object(await authorNpc({runtime:host,jobId:id,model:`${model.model.provider}/${model.model.id}`,pinned:model.source==='operator',
                        instruction:String(packet.instruction??''),input:{npc:packet.npc},signal}));
                    if(scheduler.stopped||signal.aborted||scheduler.bridge!==bridge)return;
                    await bridge.call('npc.submit',{campaign:job.campaign,job_id:id,claim,[kind]:draft[kind]});
                    await record(job.campaign,{ok:true,kind,npc:name});
                } catch {
                    if(id&&!signal.aborted&&scheduler.bridge===bridge)await bridge.call('npc.fail',{campaign:job.campaign,job_id:id,claim,reason:'author_unavailable'}).catch(()=>undefined);
                    await record(job.campaign,{ok:false,kind,npc:name,reason:signal.aborted?'cancelled':'author_unavailable'});
                }
            }
        }));
    }
}
