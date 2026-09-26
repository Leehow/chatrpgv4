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
import {bankRows,intentsView,openRows,settledCount} from './intents.js';

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
    if(saved?.source_revision!==basis(loaded,node))return [];
    return saved.status==='ready'?clone(array(saved.responses)):saved.status==='pending'?clone(array(saved.carried_responses)):[];
}
/**
 * Contract §138.4: the bank's rows the advice lane may still choose among -- every row whose intention this person has
 * not settled -- each with its reference. `entry` is the person's ledger entry (the fold of the receipts).
 */
export async function openResponseRows(loaded:Pick<Loaded,'world'|'graph'|'scope'>,node:Row,read:(file:string)=>Promise<Row|null>,entry:Row):Promise<Row[]>{
    return openRows(await responseBankFor(loaded,node,read),loaded.graph.handle(node),entry);
}
/** The smallest number of open rows a ready bank keeps before a settled intention asks for a new one (§138.4). */
const MIN_OPEN_DEFAULT=3;
async function minOpenRows(campaign:CampaignWriter):Promise<number>{
    try{
        const budgets=row(await campaign.context.snapshots.readJson(join(campaign.context.content,'rulesets','coc7','host-budgets.json')));
        const value=row(budgets.npc_responses).min_open_rows;
        return Number.isInteger(value)&&(value as number)>=0&&(value as number)<=12?value as number:MIN_OPEN_DEFAULT;
    }catch{return MIN_OPEN_DEFAULT;}
}
async function ledgerEntry(campaign:CampaignWriter,node:Row):Promise<Row>{
    const path=campaign.path('npc-ledger.json');
    return await campaign.context.snapshots.isFile(path)?row(row(await campaign.read('npc-ledger.json'))[string(node.node_id)]):{};
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
    '`tried` lists what this person already set out to do and where each stands (attempted: under way, no result yet; done, failed, ' +
    'abandoned: settled); `previous_responses` are the rows this set replaces. Never offer a settled intention again, in these or in other words: ' +
    'offer what this person does next given how those ended -- a new approach, a different demand, giving up, leaving, fighting on, bargaining. ' +
    'Each row is a different thing to try, not the same attempt worded again. ' +
    'Return only {"responses":[{"intent":"...","when":"..."}]}, 1-12 distinct rows, each string at most 400 characters.';

export function createResponseHandlers(load:(params:Row)=>Promise<Loaded>,readJob:(campaign:CampaignWriter,id:unknown)=>Promise<Row>):HandlerGroup {
    return {
        'npc.responses.job':async params=>{
            const loaded=await load(params),{campaign,world,graph,scope}=loaded,node=graph.npc(required(params,'name')!);
            if(!personalityView(graph,world,node))return {job_id:null,reason:'personality_pending'};
            const source_revision=basis(loaded,node),bank=await stored(campaign,node,scope),entry=await ledgerEntry(campaign,node);
            // §138.4: a ready bank is renewed, without anyone asking, once intentions it did not know about have settled
            // and too few of its rows are still open -- never again for the same settled count, so an author that keeps
            // re-offering what was already tried cannot loop the lane.
            const settled=settledCount(entry);
            const exhausted=bank?.status==='ready'&&bank.source_revision===source_revision&&settled>number(bank.settled_seen)
                &&openRows(array(bank.responses),graph.handle(node),entry).length<await minOpenRows(campaign);
            if(bank?.source_revision===source_revision&&bank.status==='ready'&&params.refresh!==true&&!exhausted)return {job_id:null};
            const prior=bank?.source_revision===source_revision&&bank.status==='pending'?await readJob(campaign,bank.job_id):null;
            if(prior?.status==='open')return clone(row(prior.packet));
            const sequence=prior?number(bank?.sequence):number(bank?.sequence)+1;
            const id=`npc:${jsonDigest({campaign:campaign.id,npc:node.node_id,scope,kind:'responses',source_revision,sequence})}`,claim=randomUUID();
            const memoryFile=campaign.path('memory/candidates.jsonl');
            const memory=await campaign.context.snapshots.isFile(memoryFile)?(await campaign.context.snapshots.readJsonl(memoryFile)).map(row):[];
            const npc={...npcPerspective(graph,world,node,memory,await campaign.records(),scope).view,
                // §138.4: what this person already tried and how each ended, and the rows of the bank this one replaces.
                tried:intentsView(entry),...(bank?.status==='ready'?{previous_responses:bankRows(array(bank.responses),graph.handle(node),entry).map(({ref:_ref,...value})=>value)}:{})};
            const packet={job_id:id,claim,npc,instruction};
            const job={job_id:id,claim,kind:'responses',npc:node.node_id,scope,source_revision,status:'open',packet,opened_at:nowIso()};
            await campaign.write(jobPath(id),job);
            // §138.4: the rows of the bank being renewed stay readable until the new set is accepted, so the advice lane is
            // not left with nothing for the length of an authoring call. Only a bank of the same source revision carries over.
            const carried=bank?.status==='ready'&&bank.source_revision===source_revision?array(bank.responses)
                :bank?.status==='pending'&&bank.source_revision===source_revision?array(bank.carried_responses):[];
            await campaign.write(location(node,scope),{status:'pending',job_id:id,sequence,source_revision,scope,...(carried.length?{carried_responses:carried}:{})});
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
            const {carried_responses:_carried,...kept}=bank;
            await campaign.write(location(node,scope),{...kept,status:'ready',responses,content_digest:digest,result,settled_seen:settledCount(await ledgerEntry(campaign,node)),accepted_at:nowIso()});
            await campaign.write(jobPath(job.job_id),{...job,status:'done',result});
            return result;
        },
    };
}
