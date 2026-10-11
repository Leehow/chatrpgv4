/** Optional pre-draft public evidence: advisory scores, complete read paths, one shared byte allowance. */
import {createHash} from 'node:crypto';
import type {Json,DecisionBatch} from './contracts.ts';
import type {DecisionPort} from './decision-port.ts';
import {TaskLease,type TaskClock} from './task-context.ts';
import {preparationBudget} from './preparation-budget.ts';
import {JEV_INPUT_USD_PER_MILLION} from './decision-adapter.ts';
import {JEV_MODEL,packDecisionBatch} from './question-packing.ts';
type Row=Record<string,any>;
export const PUBLIC_KNOWLEDGE_BYTES=4*1024;
export const PUBLIC_KNOWLEDGE_MIN_BYTES=512;
export const PUBLIC_KNOWLEDGE_FAMILY='public-knowledge-priority';
const row=(value:any):Row=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
const bytes=(value:unknown)=>Buffer.byteLength(JSON.stringify(value));
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const instruction='Public catalogue previews are incomplete. Every item remains reachable regardless of its score. Use issued look reads and catalogue next to consult original evidence, including older days. Scores only advise relevance and possible conflict with the player premise; the Keeper chooses what to use and how to write it. A reference reply is a conversation report, not world truth. Writing needs ordinary action admission and a canonical receipt.';

/** Keep a prefix, not a filtered ranking: the continuation begins at the first omitted row. */
export function fitKnowledgeCatalogue(catalogue:Row,documents:Row[],scores:Row={},budget=PUBLIC_KNOWLEDGE_BYTES):Row {
    const all=Array.isArray(catalogue.entries)?catalogue.entries:[],offset=Number(catalogue.offset??0);
    const packet:Row={status:catalogue.status??'unavailable',context:catalogue.context,total:catalogue.total,
        owned_documents:documents.map(value=>({name:value.name,owner:value.owner,presentation:value.presentation})),entries:[],instruction};
    const continuation=(kept:number)=>offset+kept<Number(catalogue.total??all.length)
        ?{focus:'knowledge',knowledge_page:{offset:offset+kept,limit:20,context:catalogue.context}}:undefined;
    for(let index=0;index<all.length;index++){
        const entry={...all[index],opinion:scores[index]??{status:'unavailable'}};
        const candidate={...packet,entries:[...packet.entries,entry],next:continuation(index+1)};
        if(bytes(candidate)>budget)break;
        packet.entries.push(entry);
    }
    const next=continuation(packet.entries.length);if(next)packet.next=next;
    // A pathological carrier list must not consume the evidence allowance. It still has a canonical options reader.
    if(bytes(packet)>budget){packet.owned_documents=[];packet.documents_read={focus:'object'};}
    if(bytes(packet)>budget)return {status:catalogue.status??'unavailable',context:catalogue.context,total:catalogue.total,entries:[],
        next:continuation(0)??{focus:'knowledge'},
        instruction:'Read public originals via look knowledge. Scores are advisory; ordinary admission authorizes writing.'};
    return packet;
}
/** Refit already prepared public data when source preparation needs more space, without rescoring or rereading. */
function refitKnowledge(packet:Row,budget:number):Row {
    if(bytes(packet)<=budget)return packet;
    const scores=Object.fromEntries((packet.entries??[]).map((entry:Row,index:number)=>[index,entry.opinion]));
    const fitted=fitKnowledgeCatalogue(packet,packet.owned_documents??[],scores,budget);
    if(packet.originals&&bytes({...fitted,originals:packet.originals})<=budget)fitted.originals=packet.originals;
    return fitted;
}
export async function preparePublicKnowledge(options:{campaign:string;playerText:string;call:(method:string,params:Row)=>Promise<unknown>;
    signal:AbortSignal;decision?:DecisionPort;byteBudget?:number;providerBudget?:{actions:number;inputTokens:number;outputTokens:number;costUsd:number};previous?:{signature:string;packet:Row};clock?:TaskClock;record?:(event:Row)=>void}):Promise<{signature:string;packet:Row}> {
    const available=row(await options.call('mods.document.options',{campaign:options.campaign,_knowledge_catalog:true}));
    const catalogue=row(available.knowledge),entries=Array.isArray(catalogue.entries)?catalogue.entries:[],scores:Row={};
    const signature=digest([catalogue,available.documents?.map((value:Row)=>[value.name,value.owner])]);
    const budget=Math.min(PUBLIC_KNOWLEDGE_BYTES,options.byteBudget??PUBLIC_KNOWLEDGE_BYTES)-96;
    if(options.previous?.signature===signature){
        const packet=refitKnowledge(options.previous.packet,budget);
        return packet===options.previous.packet?options.previous:{signature,packet};
    }
    const now=()=>options.clock?.now()??Date.now(),deadlineAt=now()+3000;
    let calls=0;
    if(options.decision&&entries.length&&!options.signal.aborted&&(options.providerBudget?.actions??1)>0){
        const scope={owner:PUBLIC_KNOWLEDGE_FAMILY,campaign:options.campaign,audience:'keeper' as const};
        const readSet=[{kind:'draft' as const,resource:'public-material-preview',revision:digest([signature,options.playerText])}];
        const lease=new TaskLease({owner:PUBLIC_KNOWLEDGE_FAMILY,goal:'Prioritize optional public originals without suppressing any entry',scope,readSet,
            capabilities:['decision'],signal:options.signal,...(options.clock?{clock:options.clock}:{}),
            budget:{deadlineAt,remainingActions:1,remainingInputTokens:200_000,remainingOutputTokens:20_000,remainingCostUsd:.02}});
        const accounting=preparationBudget({decision:options.decision,campaign:options.campaign,signal:options.signal,deadlineAt,
            owner:PUBLIC_KNOWLEDGE_FAMILY,...(options.clock?{clock:options.clock}:{})});
        let spend:{input:number;output:number;cost:number}|undefined;
        try{
            const batch:DecisionBatch={id:'public-material:'+signature.slice(0,16),family:PUBLIC_KNOWLEDGE_FAMILY,familyVersion:'1',model:JEV_MODEL,scope,readSet,
                state:{playerWords:options.playerText,materials:entries.map((entry:Row,index:number)=>({alias:'material_'+index,name:entry.name,preview:entry.preview,kind:entry.kind,mode:entry.mode??null})),
                    policy:'Previews are incomplete public evidence. Scores advise reading priority only. Never decide truth, action consent or catalogue membership.'} as Json,
                questions:entries.flatMap((_:Row,index:number)=>[
                    {key:'relevance_'+index,target:`materials[${index}]`,type:'noul' as const,instructions:'How relevant is this public preview to playerWords? Incomplete previews may omit relevant details.',criteria:{true:'Worth consulting for this request.',false:'Not evidently related in this preview.'}},
                    {key:'conflict_'+index,target:`materials[${index}]`,type:'noul' as const,instructions:'Does this preview conflict with a factual premise in playerWords? Do not infer a conflict from absent information or judge world truth.',criteria:{true:'The preview explicitly contradicts a premise.',false:'No explicit conflict is visible.'}}])};
            const {estimate}=packDecisionBatch(batch);
            const ceiling={input:estimate.totalUpperBound,output:estimate.responseUpperBound,cost:estimate.totalUpperBound*JEV_INPUT_USD_PER_MILLION/1_000_000};
            if(options.providerBudget&&(ceiling.input>options.providerBudget.inputTokens||ceiling.output>options.providerBudget.outputTokens||ceiling.cost>options.providerBudget.costUsd))throw new Error('optional_shared_budget_spent');
            spend=ceiling;
            const result=await accounting.decision.decide(batch,lease);calls=result.attempts;
            if(result.usage){
                const valid=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
                spend={input:valid(result.usage.inputTokens)?result.usage.inputTokens:ceiling.input,
                    output:valid(result.usage.outputTokens)?result.usage.outputTokens:ceiling.output,
                    cost:valid(result.usage.costUsd)?result.usage.costUsd:ceiling.cost};
            }
            else if(result.attempts===0)spend={input:0,output:0,cost:0};
            for(let index=0;index<entries.length;index++){
                const values=['relevance','conflict'].map(key=>result.answers[key+'_'+index]);
                if(values.every(answer=>answer?.status==='answered'&&answer.type==='noul'&&Number.isFinite(answer.noul)&&answer.noul>=0&&answer.noul<=1))
                    scores[index]={status:'available',relevance:(values[0] as any).noul,conflict:(values[1] as any).noul};
            }
        }catch{/* Optional opinions never remove public evidence. */}finally{
            if(spend&&options.providerBudget){const remaining=options.providerBudget;
                remaining.actions=Math.max(0,remaining.actions-1);remaining.inputTokens=Math.max(0,remaining.inputTokens-spend.input);
                remaining.outputTokens=Math.max(0,remaining.outputTokens-spend.output);remaining.costUsd=Math.max(0,remaining.costUsd-spend.cost);}
            lease.close();accounting.close();
        }
    }
    const packet=fitKnowledgeCatalogue(catalogue,available.documents??[],scores,Math.max(PUBLIC_KNOWLEDGE_MIN_BYTES-96,budget-928));
    // Prefetch one highest-priority original within remaining room. The catalogue and its continuation stay in source order.
    const ranked=packet.entries.map((entry:Row,index:number)=>({entry,index})).filter((value:Row)=>value.entry.status==='available')
        .sort((a:Row,b:Row)=>(b.entry.opinion.relevance??-1)-(a.entry.opinion.relevance??-1)||a.index-b.index);
    const chosen=ranked[0];
    if(chosen&&budget-bytes(packet)>512&&!options.signal.aborted){
        try{const remaining=budget-bytes(packet)-64;
            const original=row(await options.call('table.look',{campaign:options.campaign,...chosen.entry.read,
                knowledge_page:{...chosen.entry.read.knowledge_page,limit:Math.max(1,Math.floor((remaining-384)/6))}}));
            if(original.status==='original'&&bytes({...packet,originals:[original]})<=budget)packet.originals=[original];
        }catch{/* The issued original read remains usable by KP. */}
    }
    options.record?.({lane:'document_knowledge',status:'prepared',bytes:bytes(packet),entries:packet.entries.length,total:packet.total,jev_calls:calls,
        opinions:Object.keys(scores).length,originals:packet.originals?.length??0});
    return {signature,packet};
}
