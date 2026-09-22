/** Host-only NPC preparation; the existing campaign lock protects short publication, never model work. */
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {KernelContext} from '../context.js';
import type {HandlerGroup} from '../handlers.js';
import type {createWriteRuntime} from '../write/index.js';
import {nowIso,required} from '../write/store.js';
import {loadCampaignModule} from '../read/campaign.js';
import {playLanguageOf} from '../read/languages.js';
import {npcsPresent} from '../read/capsule.js';
import {RpcError} from '../errors.js';
import {isJsonObject,jsonDigest} from '../json.js';
import {array,clone,number,row,string,type Row} from '../read/values.js';
import {readNpcLedger} from '../write/contributions.js';
import {personalitySources,personalitySourceRevision,personalityView} from './material.js';
import {npcPerspective} from './perspective.js';
import {withPromiseFulfillment,canonicalMemoryReceipts} from '../read/memory.js';
import {createResponseHandlers,responseBank} from './responses.js';
import {incapacitatedBy} from '../healing/conditions.js';

const INSTRUCTION='Describe this person\'s stable values, habits of judgment and nuanced tradeoffs in two or three concise sentences. ' +
    'Use the supplied authored descriptions first. Where they are silent, a compatible personality supplement may add variety. ' +
    'Do not invent biography, relatives, secrets, knowledge, possessions, abilities, statistics or relationships. ' +
    'Do not prescribe catchphrases or force the same response on every occasion. Personality guides behavior; the situation still matters. ' +
    'Write English Keeper-facing material, not player dialogue. Return only {"personality":{"description":"..."}}.';
const jobPath=(id:string)=>join('npc','jobs',`${id}.json`);
const scopeOf=(meta:Row):Row=>{
    const worldline=string(meta.active_worldline||'main');
    return {worldline,loop:number(row(row(meta.worldlines)[worldline]).loop)};
};
function checkedPersonality(value:unknown):Row {
    if(!isJsonObject(value)||Object.keys(value).some(key=>key!=='description')||typeof value.description!=='string'
        ||!value.description.trim()||Array.from(value.description).length>1200)
        throw new RpcError('invalid_params','personality must contain only a nonempty description of at most 1200 characters');
    return {description:value.description.trim()};
}

export function createNpcHandlers(context:KernelContext,writer:ReturnType<typeof createWriteRuntime>):HandlerGroup {
    async function load(params:Row){
        const campaign=await writer.campaign(params),meta=await campaign.readCampaign();
        if(meta.status!=='active')throw new RpcError('campaign_not_ready','NPC preparation requires an active campaign');
        const world=await campaign.readWorld(),module=await loadCampaignModule(context,string(meta.module_id),world,campaign.id);
        return {campaign,meta,world,graph:module.graph,scope:scopeOf(meta)};
    }
    async function readJob(campaign:Awaited<ReturnType<typeof load>>['campaign'],value:unknown):Promise<Row>{
        if(typeof value!=='string'||!/^npc:[a-f0-9]{64}$/.test(value))throw new RpcError('invalid_params','job_id must be issued by npc.job');
        const path=jobPath(value.slice(4));
        if(!await context.snapshots.isFile(campaign.path(path)))throw new RpcError('invalid_params','Unknown NPC preparation job');
        return campaign.read(path);
    }
    async function perspectives(params:Row):Promise<Row[]> {
        const loaded=await load(params),{campaign,world,graph,scope}=loaded;
        const nodes=params.name!=null?[graph.npc(required(params,'name')!)]:npcsPresent(graph,world,graph.scene(world.active_scene));
        const memoryPath=campaign.path('memory/candidates.jsonl');
        const memory=await context.snapshots.isFile(memoryPath)?(await context.snapshots.readJsonl(memoryPath)).map(row):[];
        const records=await campaign.records(),turn=await campaign.readTurn(),ledger=await readNpcLedger(campaign);
        const projectedMemory=withPromiseFulfillment(memory,{campaign:campaign.id,world,receipts:canonicalMemoryReceipts(records,array(turn.receipts))});
        return Promise.all(nodes.map(async node=>{
            const projected=npcPerspective(graph,world,node,projectedMemory,records,scope);
            const responses=await responseBank(loaded,node),input={turn:turn.turn,player_input:turn.player_text??null};
            const present=row(world.npc_presence)[graph.handle(node)]===world.active_scene;
            const conditions=row(row(world.npc_resources)[graph.handle(node)]).conditions;
            const death=array(turn.receipts).filter(receipt=>receipt.kind==='npc'
                &&[node.node_id,graph.handle(node)].includes(receipt.npc)&&typeof receipt.dead==='boolean').at(-1);
            const dead=death?death.dead:Boolean(row(ledger[string(node.node_id)]).dead);
            const availability={present,can_act:present&&!dead&&!incapacitatedBy(Array.isArray(conditions)?conditions.map(string):[]).length};
            return {...projected.view,responses,input,scope,availability,view_revision:jsonDigest({view:projected.revision,responses,input,availability})};
        }));
    }
    return {
        ...createResponseHandlers(load,readJob),
        'npc.perspectives':async params=>({views:await perspectives(params)}),
        'npc.perspective':async params=>{
            required(params,'name');return (await perspectives(params))[0];
        },
        'npc.job':async params=>{
            const {campaign,meta,world,graph,scope}=await load(params);
            const nodes=params.name!=null?[graph.npc(required(params,'name')!)]:npcsPresent(graph,world,graph.scene(world.active_scene));
            const node=nodes.find(node=>!personalityView(graph,world,node));
            if(!node)return {job_id:null};
            const source_revision=personalitySourceRevision(graph,node),id=jsonDigest({campaign:campaign.id,npc:node.node_id,scope,source_revision});
            const path=jobPath(id),existing=await context.snapshots.isFile(campaign.path(path))?await campaign.read(path):null;
            if(existing&&existing.status==='open')return clone(row(existing.packet));
            const claim=randomUUID();
            const packet={job_id:`npc:${id}`,claim,npc:{name:graph.displayName(node),sources:personalitySources(graph,node)},
                play_language:await playLanguageOf(context,meta),instruction:INSTRUCTION};
            await campaign.write(path,{job_id:packet.job_id,claim,kind:'personality',npc:node.node_id,scope,source_revision,
                status:'open',opened_at:nowIso(),attempts:number(existing?.attempts)+1,packet});
            return packet;
        },
        'npc.submit':async params=>{
            const {campaign,world,graph,scope}=await load(params),job=await readJob(campaign,params.job_id);
            if(job.kind!=='personality')throw new RpcError('invalid_params','This is not a personality job');
            if(typeof params.claim!=='string'||params.claim!==job.claim)
                throw new RpcError('invalid_params','NPC publication claim is no longer current',{details:{reason:'npc_claim_stale'}});
            const node=graph.nodes.get(string(job.npc));
            if(!node||node.node_kind!=='npc'||jsonDigest(scope)!==jsonDigest(job.scope)
                ||personalitySourceRevision(graph,node)!==job.source_revision)
                throw new RpcError('invalid_params','NPC preparation is stale for its source or campaign scope',{details:{reason:'npc_job_stale'}});
            const personality=checkedPersonality(params.personality),digest=jsonDigest(personality);
            const entry=row(row(world.npc_character)[string(node.node_id)]),accepted=row(entry.personality);
            if(accepted.job_id===job.job_id){
                if(accepted.content_digest!==digest)throw new RpcError('idempotency_conflict','This NPC job already accepted different content');
                const result=clone(row(accepted.result));
                await campaign.write(jobPath(string(job.job_id).slice(4)),{...job,status:'done',result,completed_at:accepted.accepted_at});
                return {...result,replayed:true};
            }
            if(personalityView(graph,world,node))throw new RpcError('idempotency_conflict','This person already has an established personality');
            if(job.status!=='open')throw new RpcError('invalid_params','NPC job is not open; reclaim it before submitting');
            const at=nowIso(),result={job_id:job.job_id,npc:graph.displayName(node),personality:{...personality,origin:'table_supplement'}};
            const characters=(world.npc_character??={});
            characters[string(node.node_id)]={...entry,personality:{...personality,origin:'table_supplement',source_revision:job.source_revision,
                scope,job_id:job.job_id,content_digest:digest,accepted_at:at,accepted_turn:number(row(await campaign.readTurn()).turn),result}};
            await campaign.writeWorld(world);
            await campaign.write(jobPath(string(job.job_id).slice(4)),{...job,status:'done',result,completed_at:at});
            return result;
        },
        'npc.fail':async params=>{
            const {campaign,scope}=await load(params),job=await readJob(campaign,params.job_id);
            if(typeof params.claim!=='string'||params.claim!==job.claim)
                throw new RpcError('invalid_params','NPC failure claim is no longer current',{details:{reason:'npc_claim_stale'}});
            if(jsonDigest(scope)!==jsonDigest(job.scope))throw new RpcError('invalid_params','NPC job belongs to another campaign scope');
            if(job.status==='done')return {job_id:job.job_id,status:'done'};
            await campaign.write(jobPath(string(job.job_id).slice(4)),{...job,status:'failed',reason:string(params.reason||'unavailable'),failed_at:nowIso()});
            return {job_id:job.job_id,status:'failed'};
        },
    };
}
