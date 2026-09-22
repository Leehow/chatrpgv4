/** Shared request-local Jev evidence preparation for preload and explicit Keeper lookup. Never action authority. */
import {createDecisionAdapter} from '../../runtime/jev/decision-adapter.ts';
import {readJevApiKey,readJevPreselectEnabled} from '../jev/agent/config.js';
import type {DecisionPort} from '../../runtime/jev/decision-port.ts';
import {TaskLease} from '../../runtime/jev/task-context.ts';
import {JEV_MODEL,packDecisionBatch} from '../../runtime/jev/question-packing.ts';
import {locateCards,locatedSelection,LOCATE_FAMILY,type LocateCard,type LocateResult} from '../../runtime/jev/semantic-locate.ts';
import {preparationProviderBudget} from '../../runtime/jev/preparation-budget.ts';
import type {DecisionBatch,DecisionResult,Json,ReadSet} from '../../runtime/jev/contracts.ts';
import {workspaceCandidates} from './workspace/projection.ts';
import {customMessage,object,sizeOf,requestSize,PRESCREEN_TYPE,type ContextBinding,type Row} from './context-policy.ts';
import {candidateOf,digest,publicCoverage,publicMaterial,suppliedContext,suppliedPreview,type PrescreenCandidate,type PrescreenGap} from './prescreen-types.ts';
import {prescreenFollowTargets} from './prescreen-loop.ts';
import {runEvidenceAgent,type EvidenceOperation} from '../../runtime/jev/evidence-agent.ts';
import {keeperSupportView,validateKeeperSupport,supportRequest,validateSupportRequest,unknownCheck,type SupportRequest} from '../../runtime/jev/keeper-support-contract.ts';
import {prepareCheckPreflight,recheckPreflight,type CheckPreflightResult,type CheckPreflightCheckpoint} from '../../runtime/jev/check-preflight.ts';
import {checkPrescreenSourceCheckpoint,preparePrescreenSources,type PrescreenSourceCheckpoint,type PrescreenSourceRuntime,type PrescreenSourceResult,type PrescreenSourceSnapshot} from '../../runtime/jev/prescreen-source-provider.ts';

const FAMILY='keeper-support-agent', LIMIT=64, READ_LIMIT=12, MESSAGE_BYTES=16*1024;
// Final owner validation measured 0.76-1.1 s on a real table; the reserve scales with the configured allowance.
const FINALIZATION_RESERVE_MAX_MS=2000,FINALIZATION_RESERVE_MIN_MS=100;
const PREVIEW_CHARS=320,PREVIEW_OPERATIONS=16,SEED_SHARE=.6,LOCATE_SHARE=.35,LOCATE_MIN_MS=1000,LOOP_TRACE_LIMIT=48,FOLLOW_UNITS=3;
const METHODS=new Set(['table.look','table.lookup','table.recall']);
const KINDS=new Set(['investigator','npc','object','catalog','rule','memory','session']);
export const prescreenEnabled=(env:NodeJS.ProcessEnv=process.env):boolean=>readJevPreselectEnabled(env)&&Boolean(readJevApiKey(env));
const clip=(value:unknown,limit:number):string=>typeof value==='string'?Array.from(value).slice(0,limit).join(''):'';
function publicRead(c:PrescreenCandidate):Row|undefined {return c.read??(c.method?{tool:c.method.slice(6),...c.params}:undefined);}
function completeCatalogMaterial(candidate:PrescreenCandidate):boolean {
    return !candidate.method&&candidate.coverage.status==='complete'&&(candidate.body!==undefined||candidate.data!==undefined);
}
function materializedReadCoverage(candidate:PrescreenCandidate,data:Row):Row {
    const prior=object(candidate.coverage),owner=object(data.coverage),withoutUnread=(values:unknown):unknown[]=>
        (Array.isArray(values)?values:[]).filter(value=>value!=='material_not_read');
    return {...owner,status:'partial',omitted:[...new Set([...withoutUnread(prior.omitted),...withoutUnread(owner.omitted)])],
        unknown:[...new Set([...withoutUnread(prior.unknown),...withoutUnread(owner.unknown),'projection_completeness'])],
        supplied:[...new Set([...withoutUnread(prior.supplied),...withoutUnread(owner.supplied),'materialized_read'])]};
}
function supportMessage(value:Row,limit=Infinity):Row {
    let packet=keeperSupportView(value),message=customMessage(PRESCREEN_TYPE,packet);
    if(requestSize([message])>limit){
        const coverage=object(packet.coverage),{families,source,catalog,...summary}=coverage;
        packet={...packet,coverage:{...summary,details_omitted:true,
            ...(catalog?{catalog_next:object(catalog).continuation??null}:{})}};
        message=customMessage(PRESCREEN_TYPE,packet);
    }
    if(requestSize([message])>limit&&packet.check.basis){
        const {basis,...check}=packet.check;packet={...packet,check};message=customMessage(PRESCREEN_TYPE,packet);
    }
    return message;
}
const parseContent=(value:unknown):Row=>{try{return object(JSON.parse(String(value)));}catch{return {};}};
function publicCheckContext(messages:readonly Row[],turn:number):Array<{role:'player'|'keeper';text:string}> {
    const result:Array<{role:'player'|'keeper';text:string}>=[];
    for(const message of messages)if(message.customType==='coc-history'){
        const history=parseContent(message.content);
        for(const value of Array.isArray(history.quotes)?history.quotes:[]){const quote=object(value);
            if(quote.verified===true&&quote.truncated!==true&&quote.turn<turn&&['player','keeper'].includes(quote.role)
                &&typeof quote.text==='string'&&quote.text.length<=1200)result.push({role:quote.role,text:quote.text});}
    }
    return result.slice(-4);
}
function validRead(row:Row):boolean {
    if(!KINDS.has(row.kind)||!METHODS.has(row.method)||typeof row.label!=='string'||!row.label||!row.params||Array.isArray(row.params))return false;
    const p=object(row.params);
    if(Object.hasOwn(p,'campaign'))return false;
    if(row.method==='table.look')return ['investigator','npc','object','session'].includes(p.focus)
        &&Object.keys(p).every(k=>['focus','name'].includes(k))&&(p.name===undefined||typeof p.name==='string');
    if(row.method==='table.lookup')return ['rule','catalog'].includes(p.kind)&&typeof p.query==='string'&&Boolean(p.query.trim())
        &&Object.keys(p).every(k=>['kind','query'].includes(k));
    return p.what==='memory'&&Object.keys(p).every(k=>['what','limit','about'].includes(k))
        &&(p.limit===undefined||Number.isSafeInteger(p.limit)&&p.limit>0&&p.limit<=12)
        &&(p.about===undefined||typeof p.about==='string');
}
function alreadySupplied(candidate:PrescreenCandidate,supplied:ReturnType<typeof suppliedContext>):boolean {
    const value=candidate.body??candidate.data;if(value===undefined)return false;
    const fingerprint=digest([value,publicCoverage(candidate)]),coverage=object(candidate.coverage),complete=coverage.status==='complete'
        &&(!Array.isArray(coverage.omitted)||coverage.omitted.length===0)&&(!Array.isArray(coverage.unknown)||coverage.unknown.length===0);
    return supplied.contentDigests.get(`key:${candidate.key}`)===fingerprint
        ||Boolean(candidate.locator)&&(supplied.contentDigests.get(`locator:${candidate.locator}`)===fingerprint
            ||supplied.locators.has(candidate.locator!)&&!supplied.contentDigests.has(`locator:${candidate.locator}`))
        ||complete&&supplied.materialDigests.has(digest(value));
}
function poolOf(snapshot:Row,binding:ContextBinding,supplied:ReturnType<typeof suppliedContext>):{pool:PrescreenCandidate[];omitted:number;version:1|2;coverage:Row} {
    const materials=object(snapshot.materials),version=materials.version===2?2:1;
    if(version===2){
        const rows=Array.isArray(materials.candidates)?materials.candidates:[],pool=rows.map(candidateOf).filter((value):value is PrescreenCandidate=>Boolean(value))
            .filter(candidate=>!alreadySupplied(candidate,supplied));
        const coverage=object(materials.coverage),families=Object.values(coverage).map(object);
        return {pool,omitted:families.reduce((sum,row)=>sum+Number(row.omitted??0)+Number(row.unavailable??0),0),version,coverage};
    }
    const reads=(Array.isArray(object(snapshot.read_catalog).candidates)?snapshot.read_catalog.candidates:[])
        .map(object).filter(validRead).map((c:Row,index:number):PrescreenCandidate=>({key:typeof c.key==='string'?c.key:`read:${index}`,kind:c.kind,label:c.label,
            summary:clip(c.summary,512),method:c.method,params:c.params,coverage:{status:'partial',unknown:['material_not_read']},
            authority:c.kind==='memory'?'conversation_report':['rule','catalog'].includes(c.kind)?'rulebook_read':'current_read'}));
    const sources=workspaceCandidates(snapshot,binding).filter(c=>typeof c.body==='string'&&c.body).slice(0,24)
        .map((c):PrescreenCandidate=>{
            const name=typeof c.entity_refs?.[0]==='string'?c.entity_refs[0]:c.locator.slice(c.locator.indexOf(':')+1);
            return {key:c.locator,kind:'source',label:typeof c.name==='string'?c.name:name,summary:clip(c.text??c.body,512),
                body:c.body,authority:c.authority,locator:c.locator,coverage:structuredClone(c.coverage),
                read:{tool:'lookup',kind:c.authority==='rules_source'?'rule':'module',query:name}};
        });
    const mixed:PrescreenCandidate[]=[];
    for(let i=0;i<Math.max(reads.length,sources.length);i++){if(reads[i])mixed.push(reads[i]);if(sources[i])mixed.push(sources[i]);}
    const filtered=mixed.filter(candidate=>!alreadySupplied(candidate,supplied)),omitted=Number(object(snapshot.read_catalog).omitted||0)+Math.max(0,filtered.length-LIMIT);
    return {pool:filtered.slice(0,LIMIT),omitted,version,
        coverage:{legacy:{inspected:mixed.length,emitted:Math.min(LIMIT,filtered.length),omitted,unavailable:0}}};
}
function overview(capsule:Row):Row {
    const out:Row={},omitted:string[]=[];
    for(const key of ['turn','where','present','known','obligations','memory']) {
        const value=capsule[key];if(value===undefined)continue;
        if(sizeOf({...out,[key]:value})<=8*1024)out[key]=value;else omitted.push(key);
    }
    return {...out,...(omitted.length?{overview_omitted:omitted}: {})};
}
/** Bounded context a locate needs to resolve "here", "him" or "that room"; never the whole capsule. */
function locateContext(capsule:Row,messages:readonly Row[],turn:number):Row {
    const out:Row={},where=capsule.where;
    if(where!==undefined&&sizeOf(where)<=1500)out.where=where;
    const present=(Array.isArray(capsule.present)?capsule.present:[]).map((value:unknown)=>typeof value==='string'?value:object(value).name)
        .filter((value:unknown):value is string=>typeof value==='string'&&Boolean(value)).slice(0,16);
    if(present.length)out.present=present;
    const recent=publicCheckContext(messages,turn).slice(-2).map(quote=>({role:quote.role,text:clip(quote.text,400)}));
    if(recent.length)out.recent=recent;
    return out;
}
/** A unit preview without the entity stub every graph unit repeats; the label already names the entity. */
function previewOf(candidate:PrescreenCandidate):string {
    if(typeof candidate.body==='string'&&candidate.kind==='graph_entity'){
        try{const parsed=object(JSON.parse(candidate.body)),{entity,...rest}=parsed;
            return clip(JSON.stringify(Object.keys(rest).length?rest:{summary:object(entity).summary??candidate.summary}),PREVIEW_CHARS);}
        catch{/* An unparsable body keeps the plain clipped preview. */}
    }
    return clip(candidate.body??JSON.stringify(candidate.data??''),PREVIEW_CHARS);
}
const locateCache=new Map<string,LocateResult>();
/** The entity/rule index is query-independent: one owner read per campaign source revision, never per turn. */
const indexCache=new Map<string,Row>();
const remember=<T>(cache:Map<string,T>,key:string,value:T,limit:number):void=>{
    cache.delete(key);cache.set(key,value);while(cache.size>limit)cache.delete(cache.keys().next().value!);};
type MemorySession={snapshot:string;aliases:string[];candidateKeys:string[]};
async function expandMemoryCandidates(pool:PrescreenCandidate[],rpc:(method:string,params:Row)=>Promise<Row>):Promise<{pool:PrescreenCandidate[];sessions:MemorySession[];gaps:PrescreenGap[]}> {
    const expanded:PrescreenCandidate[]=[],sessions:MemorySession[]=[],gaps:PrescreenGap[]=[];
    for(const candidate of pool){
        if(candidate.method!=='memory.evidence'||object(candidate.params).action!=='snapshot'){expanded.push(candidate);continue;}
        try{
            const snapshot=await rpc('memory.evidence',candidate.params??{}),id=String(snapshot.snapshot??'');
            if(!id)throw new Error('memory_snapshot_unavailable');
            const aliases:string[]=[],candidateKeys:string[]=[];let offset=0,pages=0,nextOffset:number|null=null,total=0;
            for(;;){
                const page=await rpc('memory.evidence',{action:'page',snapshot:id,offset}),rows=Array.isArray(page.rows)?page.rows:[];
                total=Number.isSafeInteger(page.total)?Number(page.total):total;
                for(const row of rows.slice(0,20)){const value=object(row),alias=String(value.alias??'');if(!alias)continue;
                    const key=`memory:${digest([id,alias])}`;aliases.push(alias);candidateKeys.push(key);expanded.push({key,kind:'memory',
                        label:String(value.label??value.statement??value.subject??alias),summary:clip(JSON.stringify(value),768),authority:'conversation_report',
                        coverage:{status:'partial',unknown:['canonical_original_not_read']},data:structuredClone(value),method:'memory.evidence',
                        params:{action:'original',snapshot:id,alias},read:{tool:'recall',what:'memory',query:String(snapshot.query??'')}});}
                nextOffset=Number.isSafeInteger(page.next_offset)?Number(page.next_offset):null;
                if(nextOffset===null||++pages>=4)break;offset=nextOffset;
            }
            if(nextOffset!==null)gaps.push({alias:`memory_${gaps.length+1}`,kind:'memory',label:candidate.label,reason:'candidate_page_limit',
                read:{tool:'recall',what:'memory',query:String(snapshot.query??'')},coverage:{status:'partial',inspected:aliases.length,total,
                    omitted:Math.max(0,total-aliases.length),continuation:true}});
            sessions.push({snapshot:id,aliases,candidateKeys});
        }catch{gaps.push({alias:`memory_${gaps.length+1}`,kind:'memory',label:candidate.label,reason:'memory_evidence_unavailable',
            read:publicRead(candidate),coverage:candidate.coverage});}
    }
    return {pool:expanded,sessions,gaps};
}
async function abortable<T>(work:Promise<T>,signal:AbortSignal):Promise<T> {
    signal.throwIfAborted();let abort:()=>void=()=>{};
    try{return await Promise.race([work,new Promise<never>((_,reject)=>{abort=()=>reject(signal.reason??new Error('cancelled'));signal.addEventListener('abort',abort,{once:true});})]);}
    finally{signal.removeEventListener('abort',abort);}
}
/** Reuse an already materialized packet only after its issuing owner validates relevant keys. */
export async function reusePrescreen(input:{call:(method:string,params:Row)=>Promise<unknown>;campaign:string;binding:ContextBinding;
    query:string;message?:Row;suppliedMessages:Row[];byteBudget:number;signal:AbortSignal;source?:{moduleId:string;runtime:PrescreenSourceRuntime}}):Promise<Row|undefined> {
    const message=object(input.message),meta=object(object(message.details).prescreen),bound=object(meta.binding),keys=Array.isArray(meta.material_keys)?meta.material_keys:[];
    if(message.customType!==PRESCREEN_TYPE||!message.content||!keys.length||meta.query_digest!==digest(input.query))return undefined;
    const bindingKeys:(keyof ContextBinding)[]=['campaign','worldline','loop','turn','source_revision'];
    if(input.campaign!==input.binding.campaign||bindingKeys.some(key=>bound[key]!==input.binding[key]))return undefined;
    const signal=AbortSignal.any([input.signal,AbortSignal.timeout(500)]),sourceKeys=Array.isArray(meta.source_keys)?meta.source_keys:[],
        volatileKeys=Array.isArray(meta.volatile_keys)?meta.volatile_keys:[],workspaceKeys=keys.filter((key:string)=>!sourceKeys.includes(key)&&!volatileKeys.includes(key));
    let checkedBinding=bound,dependenciesChanged=false;const invalidWorkspaceKeys=new Set<string>();
    {
        const check=object(await abortable(input.call('table.workspace.read',{
        campaign:input.campaign,binding:bound,query:input.query,
        preselect:{version:2,mode:'check',keys:workspaceKeys}}),signal));
        const current=check.status==='valid'&&object(object(check.materials).check).status==='current';
        if(current)checkedBinding=object(check.binding);
        else {dependenciesChanged=true;for(const key of workspaceKeys)invalidWorkspaceKeys.add(key);if(!sourceKeys.length)return undefined;}
    }
    if(sourceKeys.length){
        if(!input.source||meta.source_module_id!==input.source.moduleId||!meta.source_checkpoint)return undefined;
        const sourceCheck=await checkPrescreenSourceCheckpoint({call:async(method,params)=>object(await input.call(method,{...params,campaign:input.campaign})),
            source:input.source.runtime,scope:{owner:`campaign:${input.campaign}`,campaign:input.campaign,worldline:input.binding.worldline,
                loop:input.binding.loop,audience:'keeper'},signal,deadlineAt:Date.now()+500,checkpoint:structuredClone(meta.source_checkpoint) as PrescreenSourceCheckpoint});
        if(sourceCheck.status!=='current')return undefined;
    }
    const actual=suppliedContext(input.suppliedMessages),content=parseContent(message.content);
    try{validateKeeperSupport(content);}catch{return undefined;}
    const materials=Array.isArray(content.materials)?content.materials:[];
    const baselineChanged=meta.supplied_context_digest!==actual.digest,mustReassess=baselineChanged||dependenciesChanged;
    const kept:Row[]=[],keptKeys:string[]=[],refreshGaps:Row[]=[];
    for(let index=0;index<materials.length;index++){
        const material=object(materials[index]),locator=object(material.provenance).locator,key=keys[index];
        if(invalidWorkspaceKeys.has(key))continue;
        if(volatileKeys.includes(key)){refreshGaps.push({alias:`reuse_${index+1}`,kind:material.kind??'material',label:material.label??'Volatile material',
            reason:'owner_refresh_required',coverage:material.coverage??{status:'unknown'}});continue;}
        const contentDigest=digest([material.content??null,material.coverage??null]);
        if(actual.contentDigests.get(`key:${key}`)===contentDigest
            ||typeof locator==='string'&&actual.contentDigests.get(`locator:${locator}`)===contentDigest)continue;
        let retained=material;
        if(mustReassess&&material.authority==='native_consultation'){
            const coverage=object(material.coverage),body=object(material.content),omitted=[...new Set([...(Array.isArray(coverage.omitted)?coverage.omitted:[]),'consultation_coverage'])];
            retained={...material,authority:'native_text',content:{...body,status:'raw',supported:false,prepared:false},
                coverage:{...coverage,status:'partial',supported:false,omitted},provenance:{...object(material.provenance),kind:'native_excerpt_set'},
                read:{tool:'lookup',kind:'source',query:'Authored source consultation',question:input.query,source_mode:'answer'}};
        }
        const trial={...content,materials:[...kept,retained]};if(requestSize([supportMessage(trial)])>input.byteBudget)break;
        kept.push(retained);keptKeys.push(key);
    }
    if(!kept.length)return undefined;
    const reused:Row={...content,request:input.query,materials:kept,gaps:[...(Array.isArray(content.gaps)?content.gaps.filter((gap:Row)=>!['coverage','conflict'].includes(String(gap.kind))):[]),...refreshGaps],
        coverage:{...object(content.coverage),retained:kept.length,
        reuse_omitted:materials.length-kept.length}},keptSet=new Set(keptKeys);
    if(mustReassess){delete reused.assessment;delete reused.retrieval;reused.gaps.push({alias:'reuse_assessment',kind:'coverage',label:'Reused material relevance and coverage',
        reason:'reassessment_required',coverage:{status:'unknown'}});}
    if(meta.check_checkpoint&&!mustReassess){
        const current=await recheckPreflight({campaign:input.campaign,turn:input.binding.turn,rawInput:input.query,
            scope:{owner:`campaign:${input.campaign}`,campaign:input.campaign,worldline:input.binding.worldline,loop:input.binding.loop,audience:'keeper'},
            checkpoint:meta.check_checkpoint as CheckPreflightCheckpoint,publicContext:publicCheckContext(input.suppliedMessages,input.binding.turn),
            call:input.call,signal,deadlineAt:Date.now()+500});
        if(current.status!=='current')reused.check=unknownCheck(current.reason);
    }else reused.check=unknownCheck('check_reassessment_required');
    const result=supportMessage(reused,input.byteBudget);if(requestSize([result])>input.byteBudget)return undefined;
    const packet=validateKeeperSupport(parseContent(result.content)),preparedDigest=digest(packet);
    result.details={prescreen:{...meta,prepared_digest:preparedDigest,supplied_context_digest:actual.digest,material_keys:keptKeys,
        source_keys:(Array.isArray(meta.source_keys)?meta.source_keys:[]).filter((key:string)=>keptSet.has(key)),
        volatile_keys:(Array.isArray(meta.volatile_keys)?meta.volatile_keys:[]).filter((key:string)=>keptSet.has(key)),
        refs:Object.fromEntries(Object.entries(object(meta.refs)).filter(([key])=>keptSet.has(key))),
        binding:structuredClone(checkedBinding),reused:true,needs_reassessment:mustReassess}};
    return result;
}
export type KeeperSupportInput={call:(method:string,params:Row)=>Promise<unknown>;campaign:string;binding:ContextBinding;capsule:Row;
    signal:AbortSignal;record:(event:Row)=>void;decision?:DecisionPort;timeoutMs?:number;deadlineAt?:number;env?:NodeJS.ProcessEnv;
    suppliedMessages?:Row[];byteBudget?:number;alreadySupplied?:string[];names?:string[];rules?:string[];initialSnapshot?:Row;
    source?:{moduleId:string;runtime:PrescreenSourceRuntime};providerBudget?:{actions:number;inputTokens:number;outputTokens:number;costUsd:number}};
export const preparePrescreen=(input:KeeperSupportInput):Promise<Row|undefined>=>prepareKeeperSupport(input);
export async function prepareKeeperSupport(input:KeeperSupportInput&{request?:SupportRequest}):Promise<Row|undefined> {
    const env=input.env??process.env;
    if(!input.decision&&!prescreenEnabled(env))return undefined;
    if(typeof input.binding.source_revision!=='string')return undefined;
    const began=Date.now(),availableBytes=Math.min(MESSAGE_BYTES,Math.max(0,input.byteBudget??MESSAGE_BYTES));
    const note=(event:Row)=>{try{input.record({lane:'prescreen',turn:input.binding.turn,...event});}catch{/* Advisory only. */}};
    if(availableBytes<512){note({event:'skipped',reason:'request_budget',bytes:availableBytes});return undefined;}
    if(input.providerBudget&&input.providerBudget.actions<=0){note({event:'skipped',reason:'turn_provider_budget'});return undefined;}
    const deadlineAt=input.deadlineAt??began+(input.timeoutMs??3000),remaining=Math.floor(deadlineAt-began);
    if(remaining<=0){note({event:'skipped',reason:'turn_budget_exhausted'});return undefined;}
    const signal=AbortSignal.any([input.signal,AbortSignal.timeout(Math.max(1,remaining))]);
    const finalizationReserve=Math.min(FINALIZATION_RESERVE_MAX_MS,Math.max(FINALIZATION_RESERVE_MIN_MS,Math.floor(remaining/5))),
        semanticDeadlineAt=Math.max(began+1,deadlineAt-finalizationReserve),semanticRemaining=Math.max(1,semanticDeadlineAt-began),
        semanticSignal=AbortSignal.any([input.signal,AbortSignal.timeout(semanticRemaining)]);
    const rpc=async(method:string,params:Row):Promise<Row>=>{
        signal.throwIfAborted();
        return object(await abortable(input.call(method,{...params,campaign:input.campaign}),signal));
    };
    const discoveryRpc=async(method:string,params:Row):Promise<Row>=>{
        semanticSignal.throwIfAborted();
        return object(await abortable(input.call(method,{...params,campaign:input.campaign}),semanticSignal));
    };
    let lease:TaskLease|undefined,calls=0,batches=0,inputTokens=0,outputTokens=0,inputUpperBound=0,charged=false,
        discoveryMs=0,decisionMs=0,readMs=0,validationMs=0,decisionGroupsCompleted=0,decisionGroupsTimedOut=0,decisionGroupsUnavailable=0,
        optionalDecisionTimeouts=0,optionalDecisionUnavailable=0,catalogCandidates=0,sourceCandidateCount=0,qualificationStatus='not_requested';
    const timing=()=>({discovery_ms:discoveryMs,decision_ms:decisionMs,read_ms:readMs,validation_ms:validationMs,
        finalization_reserve_ms:finalizationReserve,decision_groups_completed:decisionGroupsCompleted,
        decision_groups_timed_out:decisionGroupsTimedOut,decision_groups_unavailable:decisionGroupsUnavailable,
        optional_decision_timeouts:optionalDecisionTimeouts,optional_decision_unavailable:optionalDecisionUnavailable,qualification_status:qualificationStatus,
        catalog_candidates:catalogCandidates,source_candidates:sourceCandidateCount,allowance_ms:remaining,
        allowance_remaining_ms:Math.max(0,deadlineAt-Date.now())});
    let locateSummary:Row={status:'not_run'},retrievalOutcome:Row|undefined;
    const charge=()=>{if(charged||!input.providerBudget)return;charged=true;const remaining=lease?.context.budget;
        if(!remaining)return;input.providerBudget.actions=Math.min(Math.max(0,input.providerBudget.actions-batches),remaining.remainingActions);
        input.providerBudget.inputTokens=Math.min(Math.max(0,input.providerBudget.inputTokens-inputTokens),remaining.remainingInputTokens);
        input.providerBudget.outputTokens=Math.min(Math.max(0,input.providerBudget.outputTokens-outputTokens),remaining.remainingOutputTokens);
        input.providerBudget.costUsd=Math.min(input.providerBudget.costUsd,remaining.remainingCostUsd);};
    try{
        const playerText=String(object(input.capsule.turn).player_text??''),closed=['awaiting_player','asked'].includes(object(input.capsule.turn).state);
        if(!input.request&&(!playerText.trim()||closed))return undefined;
        const request=input.request?validateSupportRequest(input.request):supportRequest(playerText),query=request.query;
        const supplied=suppliedContext(input.suppliedMessages??[]);
        for(const locator of input.alreadySupplied??[])supplied.locators.add(locator);
        const discoveryBegan=Date.now();
        const scope={owner:`campaign:${input.campaign}`,campaign:input.campaign,worldline:input.binding.worldline,loop:input.binding.loop,audience:'keeper' as const};
        const adapter=input.decision??createDecisionAdapter({env,maxConcurrency:4});
        const providerBudget=input.providerBudget??preparationProviderBudget();
        let leaseBudget={remainingInputTokens:providerBudget.inputTokens,remainingOutputTokens:providerBudget.outputTokens,
            remainingCostUsd:providerBudget.costUsd,remainingActions:providerBudget.actions};
        const optionalDecision=async(batch:DecisionBatch,options:{lease?:TaskLease;partial?:boolean}={}):Promise<{result?:DecisionResult;reason?:'timeout'|'unavailable'}>=>{
            const owner=options.lease??lease;
            if(!owner||semanticSignal.aborted||owner.signal.aborted||Date.now()>=semanticDeadlineAt){optionalDecisionTimeouts++;return {reason:'timeout'};}
            if(batches>=providerBudget.actions)return{reason:'unavailable'};
            const started=Date.now();batches++;
            // The upper bound is what budgets reserve; provider-reported usage is what was spent. Both are kept.
            try{inputUpperBound+=packDecisionBatch(batch).estimate.totalUpperBound;}catch{/* The adapter reports the packing failure. */}
            try{
                const result=await abortable(adapter.decide(batch,owner),semanticSignal);calls+=result.attempts??0;
                if(result.usage){inputTokens+=result.usage.inputTokens;outputTokens+=result.usage.outputTokens;}
                decisionMs+=Date.now()-started;
                if(result.status!=='complete'&&!(options.partial&&result.status==='incomplete')){
                    const reason=['timeout','cancelled'].includes(String(result.failure?.code))?'timeout':'unavailable';
                    if(reason==='timeout')optionalDecisionTimeouts++;else optionalDecisionUnavailable++;return {reason};}
                return {result};
            }catch{decisionMs+=Date.now()-started;const reason=semanticSignal.aborted?'timeout':'unavailable';
                if(reason==='timeout')optionalDecisionTimeouts++;else optionalDecisionUnavailable++;return {reason};}
        };
        // Semantic locate (contract §124.10): Jev judges the whole closed entity/rule index before discovery.
        let selection:ReturnType<typeof locatedSelection>={priority:[],rules:[],seed:[]};
        if(!input.initialSnapshot){
            const locateBegan=Date.now();
            try{
                const indexKey=digest([input.campaign,input.binding.source_revision]);let index=indexCache.get(indexKey),current=Boolean(index);
                if(!index){
                    const indexView=await discoveryRpc('table.workspace.read',{preselect:{version:2,mode:'index'},query,candidate_limit:1});
                    const indexBinding=object(indexView.binding);index=object(object(indexView.materials).index);
                    current=indexView.status==='valid'&&Array.isArray(index.entities)
                        &&(['campaign','worldline','loop','turn','source_revision'] as const).every(key=>indexBinding[key]===input.binding[key]);
                    if(current)remember(indexCache,indexKey,index,4);
                }
                const cards:LocateCard[]=current&&index?[
                    ...(Array.isArray(index.entities)?index.entities:[]).map(object).filter(card=>typeof card.handle==='string'&&card.handle&&typeof card.label==='string')
                        .map(card=>({family:'entity' as const,handle:card.handle,label:card.label,kind:String(card.kind??''),summary:String(card.summary??'')})),
                    ...(Array.isArray(index.rules)?index.rules:[]).map(object).filter(card=>typeof card.name==='string'&&card.name&&typeof card.label==='string')
                        .map(card=>({family:'rule' as const,handle:card.name,label:card.label,kind:String(card.family??'')})),
                ]:[];
                if(!current)locateSummary={status:'index_unavailable'};
                else if(!cards.length)locateSummary={status:'empty_index'};
                else{
                    const context=locateContext(input.capsule,input.suppliedMessages??[],input.binding.turn),
                        cacheKey=digest([input.campaign,input.binding.source_revision,request,context,cards]);
                    let located=locateCache.get(cacheKey);const reused=Boolean(located);
                    if(!located){
                        const locateReadSet:ReadSet=[{kind:'world',resource:input.campaign,revision:digest([input.binding.worldline,input.binding.loop,input.binding.turn])},
                            {kind:'source',resource:input.campaign,revision:String(input.binding.source_revision)},
                            {kind:'model',resource:'decision',revision:JEV_MODEL},{kind:'family',resource:LOCATE_FAMILY,revision:'1'}];
                        const locateLease=new TaskLease({owner:LOCATE_FAMILY,goal:query,scope,capabilities:['decision'],readSet:locateReadSet,signal:input.signal,
                            budget:{deadlineAt:Math.min(semanticDeadlineAt,Date.now()+Math.max(LOCATE_MIN_MS,Math.floor(semanticRemaining*LOCATE_SHARE))),...leaseBudget}});
                        try{located=await locateCards({request,context:context as Json,cards,scope,readSet:locateReadSet,
                            decide:batch=>optionalDecision(batch,{lease:locateLease,partial:true}),record:note});}
                        finally{const left=locateLease.context.budget;leaseBudget={remainingInputTokens:left.remainingInputTokens,
                            remainingOutputTokens:left.remainingOutputTokens,remainingCostUsd:left.remainingCostUsd,remainingActions:left.remainingActions};
                            locateLease.close();}
                        if(located.judged)remember(locateCache,cacheKey,located,8);
                    }
                    selection=locatedSelection(located);
                    locateSummary={status:located.judged?'judged':'unjudged',reused,cards:cards.length,batches:reused?0:located.batches,
                        failed_batches:reused?0:located.failedBatches,judged:located.judged,unjudged:located.unjudged,
                        located:selection.priority.length,located_rules:selection.rules.length,seed:selection.seed.length,
                        top:located.judgments.slice(0,6).map(value=>({family:value.family,handle:clip(value.handle,120),noul:value.noul}))};
                }
            }catch(error){if(signal.aborted)throw error;locateSummary={status:'failed',reason:error instanceof Error?error.message.slice(0,160):'locate_unavailable'};}
            locateSummary.ms=Date.now()-locateBegan;
        }
        const catalogPriority=selection.priority,catalogRules=[...new Set([...selection.rules,...(input.rules??[])])].slice(0,8),
            priorityParam=catalogPriority.length?{priority:catalogPriority}:{};
        let snapshot=input.initialSnapshot?structuredClone(input.initialSnapshot):await discoveryRpc('table.workspace.read',{preselect:{version:2,mode:'catalog',cursor:0,limit:48,...priorityParam},query,
            names:input.names??[],rules:catalogRules,candidate_limit:48});
        if(snapshot.materials===undefined&&!snapshot.read_catalog)snapshot=await discoveryRpc('table.workspace.read',{preselect:true,query,names:input.names??[],rules:catalogRules,candidate_limit:48});
        const bound=object(snapshot.binding);
        if(snapshot.status!=='valid'||object(snapshot.authority).checked!==true||!bound.stateStamp
            ||bound.campaign!==input.binding.campaign||bound.worldline!==input.binding.worldline||bound.loop!==input.binding.loop
            ||bound.turn!==input.binding.turn||bound.source_revision!==input.binding.source_revision)throw new Error('binding_unavailable');
        let sourceResult:PrescreenSourceResult|undefined,sourceFailure:string|undefined,sourcePdf:string|undefined;
        if(input.source)try{
            const sourceSnapshot=object(await discoveryRpc('module.source.materials.snapshot',{module_id:input.source.moduleId,answer_limit:24,answer_cursor:0})) as PrescreenSourceSnapshot;
            sourcePdf=sourceSnapshot.pdf;
            sourceResult=await preparePrescreenSources({call:async(method,params)=>object(await input.call(method,{...params,campaign:input.campaign})),
                campaign:input.campaign,moduleId:input.source.moduleId,scope,query,capsule:input.capsule,source:input.source.runtime,
                signal:semanticSignal,budget:{deadlineAt:semanticDeadlineAt,candidateBytes:Math.max(4096,availableBytes*2),materialBytes:availableBytes,maxNativePages:16},snapshot:sourceSnapshot});
        }catch(error){if(signal.aborted)throw error;sourceFailure=error instanceof Error?error.message.slice(0,160):'source_material_unavailable';}
        let base=poolOf(snapshot,input.binding,supplied);const sourceCandidates=(sourceResult?.candidates??[]).map(candidateOf)
            .filter((value):value is PrescreenCandidate=>Boolean(value)).filter(candidate=>!supplied.keys.has(candidate.key));
        const expandedMemory=await expandMemoryCandidates(base.pool,discoveryRpc),seen=new Set<string>();let pool=[...expandedMemory.pool,...sourceCandidates]
            .filter(candidate=>{if(seen.has(candidate.key))return false;seen.add(candidate.key);return true;});
        discoveryMs=Date.now()-discoveryBegan;catalogCandidates=base.pool.length;sourceCandidateCount=sourceCandidates.length;
        let omitted=base.omitted+Number(sourceResult?.coverage.checked_answers.omitted??0)+Number(sourceResult?.coverage.native.candidate_omitted??0);
        const version=base.version;let catalogNext=Number.isSafeInteger(object(snapshot.materials).next)?Number(object(snapshot.materials).next):null,catalogPages=1;
        if(!pool.length)note({event:'catalog_empty',...(sourceFailure?{source_failure:sourceFailure}:{})});
        const combinedReadSet:ReadSet=[{kind:'world',resource:input.campaign,revision:bound.stateStamp},
            {kind:'source',resource:input.campaign,revision:input.binding.source_revision},
            ...(sourceResult?.readSet??[]),{kind:'model',resource:'decision',revision:JEV_MODEL},{kind:'family',resource:FAMILY,revision:'3'}];
        const readSet:ReadSet=combinedReadSet
            .filter((binding,index,all)=>all.findIndex(other=>other.kind===binding.kind&&other.resource===binding.resource)===index);
        // The capsule travels once, as the overview; the supplied-context preview does not repeat it.
        const current={capsule:overview(input.capsule),supplied:suppliedPreview(input.suppliedMessages??[],4096,['coc-capsule'])};
        lease=new TaskLease({owner:FAMILY,goal:query,scope,capabilities:['decision'],readSet,signal:input.signal,
            budget:{deadlineAt:semanticDeadlineAt,...leaseBudget}});
        const sourceKeys=new Set(sourceCandidates.map(candidate=>candidate.key)),materialized:PrescreenCandidate[]=[],
            gaps:PrescreenGap[]=[...expandedMemory.gaps],memoryKeys=new Set(expandedMemory.sessions.flatMap(session=>session.candidateKeys)),
            memoryFinalizers:Row[]=[],selectionTrace:Row[]=[];
        let reads=0,failed=0,qualificationCalls=0,materialOrdinal=0;
        const trace=(candidate:PrescreenCandidate,phase:string,reason:string)=>{if(selectionTrace.length<64)
            selectionTrace.push({key:candidate.key,kind:candidate.kind,phase,reason});};
        const content:Row={turn:input.binding.turn,request:query,materials:[],gaps:[],check:unknownCheck('not_prepared'),
            coverage:{inspected:pool.length,selected:0,omitted,truncated:omitted>0,
                unsearched:sourceResult?.coverage.native.unsearched_ranges??[],continuation:sourceResult?.coverage.native.next??null,
                catalog:{pages:catalogPages,candidates:catalogCandidates,continuation:catalogNext},families:structuredClone(base.coverage),
                ...(sourceResult?{source:structuredClone(sourceResult.coverage)}:{}),...(sourceFailure?{source_unavailable:sourceFailure}:{})}};
        const checkContext=publicCheckContext(input.suppliedMessages??[],input.binding.turn);
        const checkWork:Promise<CheckPreflightResult>=!playerText.trim()||closed?Promise.resolve({advice:unknownCheck('no_active_player_action'),decisionCalls:0,
            check:async()=>({status:'unavailable',reason:'no_active_player_action'})}):prepareCheckPreflight({campaign:input.campaign,turn:input.binding.turn,rawInput:playerText,scope,readSet,
            publicContext:checkContext,call:input.call,lease,signal:semanticSignal,decision:{async decide(batch){
                const outcome=await optionalDecision(batch);
                return outcome.result??{batchId:batch.id,status:'unavailable',answers:{},coverage:{required:[],answered:[],unknown:[]},issues:[],attempts:0,
                    failure:{code:outcome.reason==='timeout'?'timeout':'budget_exhausted',retryable:false}};
            }}});
        let assessment:Row|undefined;
        const loopTrace:Row[]=[],attempted=new Set<string>(),followed=new Set<string>(),qualifiedAttempts=new Set<string>(),
            directCandidates=new Set<string>();
        const originalCatalog={query,names:input.names??[],rules:catalogRules},catalogContexts=new Map(pool.map(candidate=>[candidate.key,originalCatalog]));
        const assertSnapshot=(value:Row):void=>{
            if(value.status!=='valid'||object(value.authority).checked!==true||object(object(value.materials).check).status==='stale'
                ||['campaign','worldline','loop','turn','source_revision','stateStamp','rules_revision','scene','adapter','memory_revision','npc_revision','records_revision','catalog_revision']
                    .some(key=>object(value.binding)[key]!==bound[key]))throw new Error('binding_changed');
        };
        const loopGap=(candidate:PrescreenCandidate,reason:string):void=>{
            trace(candidate,'loop',reason);gaps.push({alias:`loop_${gaps.length+1}`,kind:candidate.kind,label:candidate.label,reason,
                coverage:candidate.coverage,...(candidate.locator?{provenance:{locator:candidate.locator}}:{}),
                ...(publicRead(candidate)?{read:publicRead(candidate)}:{})});
        };
        const discover=async(target?:string):Promise<void>=>{
            const started=Date.now(),context=target?{query,names:[target],rules:catalogRules}:originalCatalog;
            let cursor=target?0:catalogNext;
            if(cursor===null)return;
            if(target)followed.add(target);
            // Targeted enumeration uses the same owner and issued keys. It does not invent graph addresses.
            for(let pageNumber=0;cursor!==null&&pageNumber<1&&reads<READ_LIMIT;pageNumber++){
                reads++;
                const page=await discoveryRpc('table.workspace.read',{binding:bound,...context,candidate_limit:48,
                    preselect:{version:2,mode:'catalog',cursor,limit:target?128:48,...priorityParam,...(target?{entity:target}:{})}});
                assertSnapshot(page);
                const pageBase=poolOf(page,input.binding,supplied),wanted=target?pageBase.pool.filter(candidate=>
                    object(candidate.read).query===target||object(candidate.params).name===target):pageBase.pool;
                const pageMemory=await expandMemoryCandidates(wanted,discoveryRpc);
                for(const candidate of pageMemory.pool){
                    if(target)directCandidates.add(candidate.key);
                    if(!seen.has(candidate.key)){seen.add(candidate.key);pool.push(candidate);catalogContexts.set(candidate.key,context);}
                }
                expandedMemory.sessions.push(...pageMemory.sessions);gaps.push(...pageMemory.gaps);
                for(const key of pageMemory.sessions.flatMap(session=>session.candidateKeys))memoryKeys.add(key);
                cursor=Number.isSafeInteger(object(page.materials).next)?Number(object(page.materials).next):null;
                catalogCandidates+=pageBase.pool.length;catalogPages++;
                if(!target)catalogNext=cursor;
            }
            if(target&&cursor!==null)gaps.push({alias:`follow_${gaps.length+1}`,kind:'source',label:target,reason:'follow_catalog_partial',
                read:{tool:'lookup',kind:'module',query:target},coverage:{status:'partial',continuation:true}});
            content.coverage.catalog={pages:catalogPages,candidates:catalogCandidates,continuation:catalogNext};
            discoveryMs+=Date.now()-started;
        };
        const readCandidate=async(candidate:PrescreenCandidate):Promise<void|(()=>void)>=>{
            attempted.add(candidate.key);let hydrated=candidate;
            const issuedRead=candidate.kind!=='rule'&&validRead(candidate);
            if(version===2&&!sourceKeys.has(candidate.key)&&!memoryKeys.has(candidate.key)&&!completeCatalogMaterial(candidate)&&!issuedRead){
                if(reads>=READ_LIMIT)return ()=>loopGap(candidate,'read_budget');
                reads++;const owner=await discoveryRpc('table.workspace.read',{binding:bound,...(catalogContexts.get(candidate.key)??originalCatalog),
                    preselect:{version:2,mode:'read',keys:[candidate.key],limit:1,...priorityParam}});assertSnapshot(owner);
                const rows:unknown[]=Array.isArray(object(owner.materials).candidates)?owner.materials.candidates:[];
                const actual=rows.map(candidateOf).find(value=>value?.key===candidate.key);
                if(!actual)return ()=>loopGap(candidate,'material_not_materialized');hydrated=actual;
            }
            if(hydrated.method&&!(hydrated.kind==='rule'&&hydrated.body!==undefined)){
                const memory=hydrated.method==='memory.evidence',session=memory?expandedMemory.sessions.find(value=>value.candidateKeys.includes(hydrated.key)):undefined;
                if(memory&&!session||!memory&&!validRead(hydrated))return ()=>loopGap(candidate,'read_not_allowed');
                if(reads>=READ_LIMIT)return ()=>loopGap(candidate,'read_budget');reads++;
                let data:Row;
                try{const params=memory?hydrated.params??{}:{...hydrated.params,_context_read:true};
                    const {_snapshot,_context,...actual}=await discoveryRpc(hydrated.method,params);data=actual;
                }catch(error){if(semanticSignal.aborted)throw error;failed++;return ()=>loopGap(candidate,'read_failed');}
                if(memory&&session){
                    if(data.verified!==true)return ()=>loopGap(candidate,'memory_original_unverified');
                    const alias=String(object(hydrated.params).alias),state=String(object(hydrated.data).state??object(hydrated.data).status??'');
                    const finalizer={action:'finish',snapshot:session.snapshot,selected:[alias],considered:[alias],unknown:[],
                        assessments:[{alias,relevance:'direct',support:'unknown',applicability:['superseded','withdrawn','corrected'].includes(state)?'superseded'
                            :state==='current'?'current':state==='historical'?'historical':'unknown',contradiction:'unknown'}]};
                    const finish=await discoveryRpc('memory.evidence',finalizer);if(finish.status==='refresh')throw new Error('memory_binding_changed');
                    const hit=(Array.isArray(finish.hits)?finish.hits:[]).map(object).find(value=>value.alias===alias);
                    if(!hit)return ()=>loopGap(candidate,'memory_finish_omitted');
                    memoryFinalizers.push(finalizer);hydrated={...hydrated,body:undefined,data:hit,refs:Array.isArray(data.refs)?data.refs:[],coverage:object(finish.coverage)};
                }else hydrated={...hydrated,body:undefined,data,coverage:materializedReadCoverage(hydrated,data)};
            }
            if(hydrated.body===undefined&&hydrated.data===undefined)return ()=>loopGap(candidate,'material_not_materialized');
            return ()=>{
                const visible=publicMaterial(hydrated,`material_${++materialOrdinal}`),trial={...content,materials:[...content.materials,visible]};
                if(requestSize([supportMessage(trial,availableBytes-512)])>availableBytes-512){loopGap(candidate,'request_budget');return;}
                content.materials.push(visible);materialized.push(hydrated);
                trace(candidate,'loop_delivery','retained');
            };
        };
        // One bounded hop: the linked entity's complete leading units are read in the same step, so a follow whose
        // target is already known still delivers it instead of ending the loop as "no progress".
        const followRelation=async(target:string):Promise<void|(()=>void)>=>{
            await discover(target);
            const publishes:Array<()=>void>=[];
            for(const candidate of pool.filter(value=>value.kind==='graph_entity'&&object(value.read).query===target
                &&!attempted.has(value.key)&&completeCatalogMaterial(value)).slice(0,FOLLOW_UNITS)){
                const publish=await readCandidate(candidate);if(typeof publish==='function')publishes.push(publish);
            }
            return publishes.length?()=>{for(const publish of publishes)publish();}:undefined;
        };
        const discoverPages=async(pages:number[]):Promise<void>=>{
            if(!sourceResult?.readNativePages||reads>=READ_LIMIT)return;reads++;const started=Date.now();
            const rows=await abortable(sourceResult.readNativePages(pages,semanticSignal),semanticSignal);
            for(const value of rows){const candidate=candidateOf(value,pool.length);if(!candidate||seen.has(candidate.key))continue;
                seen.add(candidate.key);sourceKeys.add(candidate.key);directCandidates.add(candidate.key);pool.push(candidate);sourceCandidateCount++;}
            content.coverage.source=structuredClone(sourceResult.coverage);discoveryMs+=Date.now()-started;
            if(!rows.length)gaps.push({alias:`source_${gaps.length+1}`,kind:'source',label:`Original PDF pages ${pages.join(', ')}`,
                reason:'native_continuation_unavailable',coverage:{status:'unknown'},read:{tool:'lookup',kind:'source',query}});
        };
        const qualifySources=async(keys:string[],key:string):Promise<void|(()=>void)>=>{
            qualifiedAttempts.add(key);
            const needed=sourceResult?.nativeQualificationActions(keys);
            if(needed===undefined||needed>providerBudget.actions-batches)return ()=>gaps.push({alias:`qualification_${gaps.length+1}`,
                kind:'source',label:'Original source support',reason:'native_qualification_budget',read:{tool:'lookup',kind:'source',query}});
            const qualification=await sourceResult!.qualifyNative(keys,async request=>{
                const batch:DecisionBatch={...request.batch,id:digest(['support-native',request.key,request.batch.state]),scope,readSet};
                const outcome=await optionalDecision(batch);
                return outcome.result??{batchId:batch.id,status:'unavailable',answers:{},coverage:{required:[],answered:[],unknown:[]},issues:[],attempts:0,
                    failure:{code:outcome.reason==='timeout'?'timeout':'budget_exhausted',retryable:false}};
            },semanticSignal);
            qualificationCalls+=qualification.calls;qualificationStatus=qualification.status;
            if(qualification.status!=='qualified')return ()=>gaps.push({alias:`qualification_${gaps.length+1}`,kind:'source',
                label:'Original source support',reason:qualification.gap.reason,coverage:qualification.gap.coverage,read:publicRead(materialized.find(row=>keys.includes(row.key))!)});
            const candidate=candidateOf(qualification.candidate,0);if(!candidate)return;
            return ()=>{
                const positions=materialized.flatMap((value,index)=>keys.includes(value.key)?[index]:[]);if(!positions.length)return;
                const first=positions[0],visible=publicMaterial(candidate,content.materials[first].alias),kept=content.materials.filter((_:Row,index:number)=>!positions.includes(index));
                kept.splice(first,0,visible);
                if(requestSize([supportMessage({...content,materials:kept},availableBytes-512)])>availableBytes-512)return void gaps.push({alias:`qualification_${gaps.length+1}`,kind:'source',
                    label:'Original source support',reason:'native_qualification_request_budget',read:{tool:'lookup',kind:'source',query}});
                content.materials=kept;const originals=materialized.filter((_,index)=>!positions.includes(index));originals.splice(first,0,candidate);
                materialized.splice(0,materialized.length,...originals);sourceKeys.add(candidate.key);
            };
        };
        // Exact reads of what the locate found (noul >= FOUND): the host copies owner units through the same
        // staged publication and byte trial as any loop read, leaving room for what the loop discovers next.
        let seeded=0;
        for(const handle of selection.seed){
            for(const candidate of pool.filter(value=>value.kind==='graph_entity'&&object(value.read).query===handle&&!attempted.has(value.key))){
                if(semanticSignal.aborted||requestSize([supportMessage(content)])>availableBytes*SEED_SHARE)break;
                const publish=await readCandidate(candidate);
                if(typeof publish==='function'){const before=content.materials.length;publish();if(content.materials.length>before){seeded++;trace(candidate,'locate_seed','located');}}
            }
        }
        if(locateSummary.status!=='not_run')locateSummary.seeded=seeded;
        const traceEvent=(event:Row):void=>{if(loopTrace.length>=LOOP_TRACE_LIMIT)return;
            loopTrace.push(Object.fromEntries(Object.entries(event).map(([key,value])=>[key,typeof value==='string'?clip(value,160):value])));};
        if(assessment?.coverage!=='sufficient'){
            const retrieval=await runEvidenceAgent({request,current,scope,readSet,signal:semanticSignal,
                assessWhenEmpty:true,
                canContinue:()=>providerBudget.actions>batches&&Date.now()<semanticDeadlineAt,
                decide:optionalDecision,record:event=>{if(event.event==='loop_cycle'&&event.tool==='read')readMs+=Number(event.ms??0);
                    if(event.event==='loop_operation_incomplete'){const candidate=pool.find(candidate=>`read:${candidate.key}`===event.key);
                        if(candidate)loopGap(candidate,'loop_timeout');}
                    traceEvent(event);note(event);},
                snapshot:()=>{
                    const operations:EvidenceOperation[]=[];
                    const nativeKeys=materialized.filter(candidate=>candidate.authority==='native_text'&&sourceKeys.has(candidate.key)).map(candidate=>candidate.key),
                        qualificationKey=digest(nativeKeys);
                    if(nativeKeys.length&&sourceResult?.nativeQualificationActions(nativeKeys)!==undefined&&!qualifiedAttempts.has(qualificationKey))operations.push({
                        key:`qualify:${qualificationKey}`,tool:'read',label:'Validate original source support',
                        description:'Use the existing source owner to decide whether the retained raw excerpts support this question. Required for a supported native consultation; does not grant visual proof or prepare game state.',
                        execute:async()=>qualifySources(nativeKeys,qualificationKey)});
                    if(sourceResult?.readNativePages&&reads<READ_LIMIT){
                        const unread=sourceResult.coverage.native.unmaterialized_pages,adjacent=new Set<number>();
                        for(const material of content.materials){const origin=object(material.provenance),pages=Number.isSafeInteger(origin.page)?[origin.page]
                            :Array.isArray(origin.pages)?origin.pages:[];
                            for(const page of pages)for(const neighbor of [page-1,page+1])if(unread.includes(neighbor))adjacent.add(neighbor);}
                        for(const page of adjacent)operations.push({key:`native:${page}`,tool:'follow',label:`Original PDF page ${page}`,
                            description:'Read the adjacent original page to recover conditions or context outside a retained excerpt.',
                            basis:{page},execute:async()=>discoverPages([page])});
                        const next=unread.filter(page=>!adjacent.has(page)).slice(0,2);
                        if(next.length)operations.push({key:`native:${next.join(',')}`,tool:'discover',label:'More original PDF text',
                            description:'Read the next unmaterialized original pages; empty text is not proof of source absence.',
                            basis:{pages:next},execute:async()=>discoverPages(next)});
                    }
                    if(version===2&&reads<READ_LIMIT)for(const link of prescreenFollowTargets(content.materials))if(!followed.has(link.target))operations.push({
                        key:`follow:${digest(link.target)}`,tool:'follow',label:link.target,
                        description:'Follow this explicit relation: discover the linked entity\'s source units and read its complete leading units; this does not change the world.',
                        basis:{from:link.from,relation:link.relation,target:link.target},execute:async()=>followRelation(link.target)});
                    // Reads are offered in discovery order (semantic locate first), paged by the agent's frontier;
                    // no decision is spent opening fixed-size index groups. The leading reads carry a content preview,
                    // the rest their label and kind, so one page stays small without hiding any candidate.
                    let previewed=0;
                    for(const candidate of pool)if(!attempted.has(candidate.key)&&(reads<READ_LIMIT||completeCatalogMaterial(candidate)))operations.push({key:`read:${candidate.key}`,tool:'read',label:candidate.label,
                        description:`Read actual ${candidate.kind} material.`,
                        basis:{kind:candidate.kind,authority:candidate.authority,...(previewed++<PREVIEW_OPERATIONS?{preview:previewOf(candidate)}:{})},
                        concurrencyKey:memoryKeys.has(candidate.key)?`memory:${String(object(candidate.params).snapshot)}`:candidate.key,
                        execute:async()=>readCandidate(candidate)});
                    if(version===2&&catalogNext!==null&&reads<READ_LIMIT)operations.unshift({key:`discover:${catalogNext}`,tool:'discover',label:'More campaign material',
                        description:'Continue the current owner catalog to discover further source, rule, history, memory or current-state candidates.',
                        execute:async()=>discover()});
                    return {materials:content.materials,gaps:gaps.slice(0,12).map(({kind,label,reason})=>({kind,label,reason})),
                        omittedGaps:Math.max(0,gaps.length-12),operations};
                }});
            retrievalOutcome={status:retrieval.status,stop_reason:retrieval.stop_reason,steps:retrieval.steps,rounds:retrieval.rounds};
            if(retrieval.assessment)assessment=retrieval.assessment;else if(retrieval.steps)assessment=undefined;
            if(retrieval.stop_reason!=='frontier_exhausted'||retrieval.steps){
                const {assessment:ignored,...summary}=retrieval;content.retrieval=summary;
                if(retrieval.status==='partial'){
                    gaps.push({alias:'retrieval',kind:'coverage',label:'Adaptive material retrieval',reason:retrieval.stop_reason});
                    for(const candidate of pool.filter(candidate=>!attempted.has(candidate.key)))
                        loopGap(candidate,`loop_${retrieval.stop_reason}`);
                }
            }
        }
        if(assessment?.coverage!=='sufficient')gaps.push({alias:'coverage',kind:'coverage',label:'Remaining evidence coverage',reason:String(assessment?.coverage??'unknown')});
        if(assessment?.consistency&&assessment.consistency!=='clear')gaps.push({alias:'consistency',kind:'conflict',label:'Relevant evidence consistency',reason:String(assessment.consistency)});
        // All owner checks happen after every dependent decision/read, immediately before publish.
        const validationBegan=Date.now();signal.throwIfAborted();
        const checkResult=await checkWork;
        const finalWorkspaceKeys=materialized.map(candidate=>candidate.key).filter(key=>!sourceKeys.has(key)&&!memoryKeys.has(key));
        const [checkValidity,check]=await Promise.all([
            checkResult.checkpoint?checkResult.check(signal,deadlineAt-25):Promise.resolve({status:'unavailable' as const,reason:'check_unavailable'}),
            rpc('table.workspace.read',{binding:bound,candidate_limit:1,
                ...(version===2?{preselect:{version:2,mode:'check',keys:finalWorkspaceKeys}}:{})}),
            (async()=>{for(const finalizer of memoryFinalizers){const final=await rpc('memory.evidence',finalizer);
                if(final.status==='refresh')throw new Error('memory_binding_changed');}})(),
            (async()=>{if(sourceResult&&input.source){const sourceCheck=await checkPrescreenSourceCheckpoint({
                call:async(method,params)=>object(await input.call(method,{...params,campaign:input.campaign})),source:input.source.runtime,scope,signal,deadlineAt,
                checkpoint:sourceResult.checkpoint});if(sourceCheck.status!=='current')throw new Error(`source_${sourceCheck.status}`);}})(),
        ]);
        content.check=checkValidity.status==='current'?checkResult.advice:unknownCheck(checkValidity.reason);
        if(check.status!=='valid'||['campaign','worldline','loop','turn','source_revision','stateStamp','rules_revision','scene','adapter']
            .some(k=>object(check.binding)[k]!==bound[k]))throw new Error('binding_changed');
        signal.throwIfAborted();validationMs=Date.now()-validationBegan;
        if(assessment)content.assessment=assessment;
        const publicGaps=gaps.length>12?[...gaps.slice(0,8),...gaps.slice(-4)]:gaps;
        content.gaps=publicGaps.map(gap=>({...gap,...(gap.coverage?{coverage:publicCoverage({coverage:gap.coverage,read:gap.read})}:{})}));
        const retrievalSummary=content.retrieval;
        content.coverage.inspected=pool.length;content.coverage.selected=attempted.size;
        const gapsOmittedByReason:Row={};content.coverage.gaps_omitted_by_reason=gapsOmittedByReason;
        for(const gap of gaps)if(!publicGaps.includes(gap)){
            content.coverage.gaps_omitted=(content.coverage.gaps_omitted??0)+1;
            gapsOmittedByReason[gap.reason]=Number(gapsOmittedByReason[gap.reason]??0)+1;
        }
        // Optional loop diagnostics must not evict the evidence they describe.
        if(content.retrieval&&requestSize([supportMessage(content,availableBytes)])>availableBytes)delete content.retrieval;
        if(requestSize([supportMessage(content,availableBytes)])>availableBytes){
            const suppliedReads=new Set(content.materials.filter((material:Row)=>material.read).map((material:Row)=>JSON.stringify(material.read)));
            content.gaps=content.gaps.map((gap:Row)=>({alias:gap.alias,kind:gap.kind,label:gap.label,reason:gap.reason,
                ...(gap.read&&!suppliedReads.has(JSON.stringify(gap.read))?{read:gap.read}:{}),
                ...(!gap.read&&gap.provenance?{provenance:gap.provenance}:{})}));
        }
        while(content.gaps.length&&requestSize([supportMessage(content,availableBytes)])>availableBytes){const removed=object(content.gaps.pop()),reason=String(removed.reason??'unknown');
            content.coverage.gaps_omitted=(content.coverage.gaps_omitted??0)+1;gapsOmittedByReason[reason]=Number(gapsOmittedByReason[reason]??0)+1;}
        if(!Object.keys(gapsOmittedByReason).length)delete content.coverage.gaps_omitted_by_reason;
        signal.throwIfAborted();
        if(requestSize([supportMessage(content,availableBytes)])>availableBytes)content.check=unknownCheck('check_request_budget');
        while(content.materials.length&&requestSize([supportMessage(content,availableBytes)])>availableBytes){
            content.materials.pop();const removed=materialized.pop()!;loopGap(removed,'final_request_budget');
            if(!content.coverage.materials_omitted)content.gaps.push({alias:'final_budget',kind:'coverage',label:'Retained material budget',reason:'final_request_budget'});
            content.coverage.materials_omitted=(content.coverage.materials_omitted??0)+1;
            content.coverage.truncated=true;content.assessment={coverage:'uncertain',consistency:'uncertain'};
            content.retrieval=null;
        }
        const message=supportMessage(content,availableBytes);
        if(requestSize([message])>availableBytes){note({event:'skipped',reason:'support_frame_budget',bytes:availableBytes});charge();return undefined;}
        const packet=validateKeeperSupport(parseContent(message.content));
        const preparedDigest=digest(packet);
        message.details={prescreen:{version:2,prepared_digest:preparedDigest,supplied_context_digest:supplied.digest,
            query_digest:digest(query),
            material_keys:materialized.map(candidate=>candidate.key),candidate_keys:[...attempted],
            source_keys:materialized.filter(candidate=>sourceKeys.has(candidate.key)).map(candidate=>candidate.key),
            volatile_keys:materialized.filter(candidate=>memoryKeys.has(candidate.key)).map(candidate=>candidate.key),
            source_module_id:input.source?.moduleId,source_pdf:sourcePdf,
            source_read_set:sourceResult?.readSet,
            source_checkpoint:sourceResult?.checkpoint,
            check_checkpoint:checkValidity.status==='current'&&content.check===checkResult.advice?checkResult.checkpoint:undefined,
            refs:Object.fromEntries(materialized.filter(candidate=>candidate.refs?.length).map(candidate=>[candidate.key,candidate.refs])),
            binding:structuredClone(bound),coverage:structuredClone(content.coverage),gap_details:structuredClone(gaps),selection_trace:selectionTrace,loop_trace:loopTrace,
            ...(retrievalSummary?{retrieval:retrievalSummary}:{})}};
        const decisionChoices=loopTrace.filter(event=>event.event==='loop_decision').slice(0,16)
            .map(({round,choice,tool,coverage,consistency})=>({round,choice,tool,coverage,consistency}));
        // Why the loop ended, what it judged and what it chose: "sufficient" and "gave up" stay distinguishable.
        const outcome={stop_reason:retrievalOutcome?.stop_reason??'not_run',retrieval:retrievalOutcome??null,
            assessment:content.assessment??null,choices:decisionChoices,locate:locateSummary};
        Object.assign(message.details.prescreen,{decision_batches:batches,jev_calls:calls,qualification_calls:qualificationCalls,
            jev_input_tokens:inputTokens,jev_output_tokens:outputTokens,jev_input_upper_bound:inputUpperBound,...outcome,...timing()});
        note({event:'prepared',candidates:pool.length,selected:attempted.size,supplemented:0,
            uncertain:assessment?.coverage==='uncertain'?materialized.length:0,
            reads,failed,supplied:materialized.length,follow_up:gaps.length,omitted,bytes:requestSize([message]),ms:Date.now()-began,
            supplied_sources:materialized.map(({kind,label,authority})=>({kind,label,authority})),
            pending_reads:gaps.map(({kind,label,reason})=>({kind,label,reason})),prepared_digest:preparedDigest,supplied_context_digest:supplied.digest,
            decision_batches:batches,jev_calls:calls,qualification_calls:qualificationCalls,jev_input_tokens:inputTokens,jev_output_tokens:outputTokens,
            jev_input_upper_bound:inputUpperBound,...outcome,loop_trace:loopTrace,
            selection_trace:selectionTrace,usage_complete:decisionGroupsTimedOut===0&&decisionGroupsUnavailable===0&&optionalDecisionTimeouts===0&&optionalDecisionUnavailable===0
                &&qualificationStatus!=='unavailable',...timing()});
        charge();return message;
    }catch(error){charge();note({event:'fallback',reason:signal.aborted?'cancelled_or_timeout':error instanceof Error?error.message:'unavailable',
        ms:Date.now()-began,decision_batches:batches,jev_calls:calls,jev_input_tokens:inputTokens,jev_output_tokens:outputTokens,
        jev_input_upper_bound:inputUpperBound,stop_reason:retrievalOutcome?.stop_reason??'not_run',retrieval:retrievalOutcome??null,locate:locateSummary,
        usage_complete:false,...timing()});return undefined;}
    finally{lease?.close();}
}
