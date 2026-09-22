/** Conditional response banks are derived preparation artifacts, never accepted world effects. */
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {RpcError} from '../errors.js';
import {isJsonObject,jsonDigest} from '../json.js';
import type {HandlerGroup} from '../handlers.js';
import type {ModuleGraph} from '../read/module-graph.js';
import {array,clone,number,row,string,type Row} from '../read/values.js';
import {CampaignWriter,nowIso,required} from '../write/store.js';
import {personalitySourceRevision,personalityView} from './material.js';
import {npcPerspective} from './perspective.js';

type Loaded={campaign:CampaignWriter;world:Row;graph:ModuleGraph;scope:Row;meta:Row};
const location=(node:Row,scope:Row)=>join('npc','responses',`${jsonDigest({npc:node.node_id,scope})}.json`);
const jobPath=(id:string)=>join('npc','jobs',`${id.slice(4)}.json`);
function basis({world,graph,scope}:Pick<Loaded,'world'|'graph'|'scope'>,node:Row):string {
    return jsonDigest({scope,scene:row(world.npc_presence)[graph.handle(node)]??null,source:personalitySourceRevision(graph,node),personality:personalityView(graph,world,node),
        reunions:row(row(world.npc_character)[string(node.node_id)]).reunions??null,
        knowledge:graph.npcKnows(node).map(item=>({name:item.handle,text:item.node.summary??item.node.name})),beliefs:graph.npcBeliefs(node)});
}
async function stored(campaign:CampaignWriter,node:Row,scope:Row):Promise<Row|null>{
    const file=location(node,scope);
    return await campaign.context.snapshots.isFile(campaign.path(file))?campaign.read(file):null;
}
export async function responseBank(loaded:Loaded,node:Row):Promise<Row[]>{
    return responseBankFor(loaded,node,file=>loaded.campaign.context.snapshots.isFile(loaded.campaign.path(file)).then(exists=>exists?loaded.campaign.read(file):null));
}
export async function responseBankFor(loaded:Pick<Loaded,'world'|'graph'|'scope'>,node:Row,read:(file:string)=>Promise<Row|null>):Promise<Row[]>{
    const saved=await read(location(node,loaded.scope));
    return saved?.status==='ready'&&saved.source_revision===basis(loaded,node)?clone(array(saved.responses)):[];
}
export function responseHint(name:string,count:number):Row {
    return {count,next:{tool:'look',focus:'npc',name,evaluate_responses:true},authority:'advisory_only'};
}
function checked(value:unknown):Row[]{
    if(!Array.isArray(value)||value.length<1||value.length>12)throw new RpcError('invalid_params','responses must contain 1-12 conditional intentions');
    const rows=value.map(item=>{
        if(!isJsonObject(item)||Object.keys(item).some(k=>!['intent','when'].includes(k))
            ||['intent','when'].some(k=>typeof item[k]!=='string'||!string(item[k]).trim()||Array.from(string(item[k])).length>400))
            throw new RpcError('invalid_params','Each response contains only bounded nonempty intent and when strings');
        return {intent:string(item.intent).trim(),when:string(item.when).trim()};
    });
    if(new Set(rows.map(r=>jsonDigest(r))).size!==rows.length)throw new RpcError('invalid_params','Response intentions must be distinct');
    return rows;
}
const instruction='Prepare a small varied set of conditional response intentions for this NPC, using only the supplied limited perspective. ' +
    'These are possibilities for the Keeper, not dialogue, facts or executed actions. Consider the person\'s values, concrete shared history, ' +
    'existing commitments and what they actually know. Each intent says what the person could try to accomplish; when says the observable ' +
    'circumstances that would make it appropriate. Include ordinary cooperation and natural closure where supported, alongside meaningful ' +
    'conditions or refusal. Do not manufacture secrets, motives, relationships, capabilities, prices, items or obligations. ' +
    'Do not ask a player to repeat an already chosen decision, prevent an agreed departure, or create a task just to keep talking. ' +
    'Do not convert beliefs or reports to world truth. Avoid catchphrases and personality stereotypes. Write English Keeper-facing material. ' +
    'Return only {"responses":[{"intent":"...","when":"..."}]}, 1-12 distinct rows, each string at most 400 characters.';

export function createResponseHandlers(load:(params:Row)=>Promise<Loaded>,readJob:(campaign:CampaignWriter,id:unknown)=>Promise<Row>):HandlerGroup {
    return {
        'npc.responses.job':async params=>{
            const loaded=await load(params),{campaign,world,graph,scope}=loaded,node=graph.npc(required(params,'name')!);
            if(!personalityView(graph,world,node))return {job_id:null,reason:'personality_pending'};
            const source_revision=basis(loaded,node),bank=await stored(campaign,node,scope);
            if(bank?.source_revision===source_revision&&bank.status==='ready'&&params.refresh!==true)return {job_id:null};
            const prior=bank?.source_revision===source_revision&&bank.status==='pending'?await readJob(campaign,bank.job_id):null;
            if(prior?.status==='open')return clone(row(prior.packet));
            const sequence=prior?number(bank?.sequence):number(bank?.sequence)+1;
            const id=`npc:${jsonDigest({campaign:campaign.id,npc:node.node_id,scope,kind:'responses',source_revision,sequence})}`,claim=randomUUID();
            const memoryFile=campaign.path('memory/candidates.jsonl');
            const memory=await campaign.context.snapshots.isFile(memoryFile)?(await campaign.context.snapshots.readJsonl(memoryFile)).map(row):[];
            const npc=npcPerspective(graph,world,node,memory,await campaign.records(),scope).view;
            const packet={job_id:id,claim,npc,instruction};
            const job={job_id:id,claim,kind:'responses',npc:node.node_id,scope,source_revision,status:'open',packet,opened_at:nowIso()};
            await campaign.write(jobPath(id),job);
            await campaign.write(location(node,scope),{status:'pending',job_id:id,sequence,source_revision,scope});
            return packet;
        },
        'npc.responses.submit':async params=>{
            const loaded=await load(params),{campaign,graph,scope}=loaded,job=await readJob(campaign,params.job_id),node=graph.nodes.get(string(job.npc));
            if(job.kind!=='responses'||!node||jsonDigest(scope)!==jsonDigest(job.scope)||basis(loaded,node)!==job.source_revision)
                throw new RpcError('invalid_params','Response preparation is stale',{details:{reason:'npc_bank_stale'}});
            const bank=await stored(campaign,node,scope);
            if(!bank||bank.job_id!==job.job_id)throw new RpcError('invalid_params','A newer response preparation owns publication',{details:{reason:'npc_bank_stale'}});
            if(typeof params.claim!=='string'||params.claim!==job.claim)throw new RpcError('invalid_params','Response claim is stale',{details:{reason:'npc_claim_stale'}});
            const responses=checked(params.responses),digest=jsonDigest(responses);
            if(bank.status==='ready'){
                if(bank.content_digest!==digest)throw new RpcError('idempotency_conflict','This response job already accepted different content');
                await campaign.write(jobPath(job.job_id),{...job,status:'done',result:bank.result});
                return {...row(bank.result),replayed:true};
            }
            if(job.status!=='open')throw new RpcError('invalid_params','Reclaim the failed response job before publishing');
            const result={job_id:job.job_id,npc:graph.displayName(node),responses};
            await campaign.write(location(node,scope),{...bank,status:'ready',responses,content_digest:digest,result,accepted_at:nowIso()});
            await campaign.write(jobPath(job.job_id),{...job,status:'done',result});
            return result;
        },
    };
}
