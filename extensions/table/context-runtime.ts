import {locationToolDeclarations,projectLocationInspections,locationIdentityContext} from './location-context.ts';
import {keeperCapsuleHead,keeperCapsuleMessage} from '../../runtime/instruction-audience.ts';
import {locationContextRelevance} from './location-relevance.ts';
import {createDecisionAdapter} from '../../runtime/jev/decision-adapter.ts';
import {readJevApiKey,readJevPreselectAllowanceMs} from '../jev/agent/config.js';
import {preparationBudget,preparationProviderBudget} from '../../runtime/jev/preparation-budget.ts';
import type {DecisionPort} from '../../runtime/jev/decision-port.ts';
import type {TaskProviderBudget} from '../../runtime/jev/provider-budget.ts';
/** Request and persistence adapters for the one bounded play-context policy. */
import {createHash} from 'node:crypto';
import {createRequestJournal} from './request-journal.ts';
import type {MaterialScreenPort} from './material-screen.ts';
import {createSnapshotReadCache} from './history-original-cache.ts';
import {policyFor} from '../anthropic-cache/shared/policy.js';
import {dirname, join} from 'node:path';
import type {ContextEvent, ContextEventResult, ExtensionAPI, ExtensionContext, ToolResultEvent} from '@earendil-works/pi-coding-agent';
import {getCurrentSystemMessage,getCurrentTools} from '@earendil-works/pi-ai';
import {COC_TOOLS} from '../kernel/tools.ts';
import {offeredTools} from '../kernel/lean-apply.ts';
import {createCapabilityRuntime} from './capability-runtime.ts';
import {capabilityCatalogue,capabilityDetail} from './capability-catalogue.ts';
import {createTurnDisclosure} from './turn-disclosure.ts';
import {createModDiscovery} from './mod-discovery.ts';
import {compactAt} from './fold.ts';
import {NO_UNTOLD, renameHandles, untoldRoster as readUntold, untoldView, type UntoldRoster} from '../kernel/untold-view.ts';
import {createWorkpadStore, type WorkpadView} from './workspace/workpad-store.ts';
import {selectWorkspace, workspaceBudgetOf, workspaceModeOf, workspaceSettingsOf, workspaceCandidates, type WorkspaceMode} from './workspace/projection.ts';
import {reuseEvidence, dormantEvidence} from './workspace/evidence.ts';
import {rankWorkspaceCandidates} from './workspace/reranker.ts';
import {preparePrescreen,prescreenEnabled,reusePrescreen} from './prescreen.ts';
import type {PrescreenSourceRuntime} from '../../runtime/jev/prescreen-source-provider.ts';
import {createExpressionPreparation,EXPRESSION_MESSAGE} from './expression-reference.ts';
import {createModSections,emptyCalls,noteCall,applyEffectKinds,MOD_SECTIONS_MESSAGE} from './mod-sections.ts';
import {createTemporalAdvice,TEMPORAL_ADVICE_MESSAGE} from './temporal-advice.ts';
import {createWritingSupportNames} from '../../runtime/writing-support.ts';
import {bindingOf, customMessage, epochOf, sourceOf, historyView, metadata, quoteView, briefForTurn, projectedMessages, foldPlan,
    boundedTail, retainsLatestToolBatch, requestBudget, BYTES_PER_TOKEN, HISTORY_BYTES, POLICY_VERSION, DIAGNOSTIC_TYPE, WORKSPACE_TYPE, PRESCREEN_TYPE, entryMessage, object, sizeOf, requestSize,
    capsuleUpdate, stableFirst, CAPSULE_UPDATE_TYPE, NPC_ADVICE_TYPE, CLERK_TYPE, BRIEF_TYPE,
    type ContextBinding, type Quote, type Row} from './context-policy.ts';
/** §228.3: what a result carries when a write used detail it was not shown. */
const ATTACHED_AUTHORITY='Detail this call used before it was shown to you: exact package sections and apply fields, as instructions. Follow them for later decisions of this kind; a write that already landed is not redone for them.';
/** §228.2: a turn detail message: apply fields for kinds this turn is likely to use. */
const CAPABILITY_DETAIL_TYPE='coc-capability-detail';
const SECTIONS_AUTHORITY='Full sections of active locked packages relevant to this turn. They are instructions, not player input, world facts, permission or new goals.';
const CAPABILITY_AUTHORITY='Exact apply fields of the effect kinds named here, for this turn. They are instructions about tool use, not player input, world facts, permission or new goals.';

type KernelCall = (method: string, params: Row) => Promise<unknown>;
type Prepared = {binding: ContextBinding; capsule: Row; history: Row; brief: Row; key: string; answering?: string[];
    workspace?: Row; workspaceMode: WorkspaceMode};
const fingerprint = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** Contract §184.3: the first 12 hex characters of a SHA-256, enough to tell two requests' segments apart. */
const shortDigest = (value: unknown): string => fingerprint(value).slice(0, 12);
const SEGMENT_LIMIT = 64;
/**
 * Contract §184.3: one `{kind, bytes, digest}` per outgoing message, in request order, so a cache miss in the token ledger
 * can be attributed to the first segment whose digest changed. `kind` is the custom type, else the role.
 */
function requestSegments(messages: readonly Row[]): Row {
    const segments = messages.slice(0, SEGMENT_LIMIT).map(message => ({
        kind: message.role === 'custom' && typeof message.customType === 'string' ? message.customType : message.role,
        bytes: requestSize([message]),
        digest: shortDigest({role: message.role, customType: message.customType, content: message.content}),
    }));
    return {segments, ...(messages.length > SEGMENT_LIMIT ? {segments_truncated: messages.length - SEGMENT_LIMIT} : {})};
}
/** The key the brief is rebuilt on (§183, §187.4); exported for its test. */
export const briefingKey = (binding: ContextBinding, capsule: Row): string => {
    const instructions = object(capsule.mods).instructions;
    // Frozen package versions bind their bytes, and a package's form (§183.3: full or indexed) follows from the set and
    // its order; never reuse an old effective provider or its settings after activation.
    const providers = Array.isArray(instructions) ? instructions.map(value => {
        const row = object(value);
        return {mod: row.mod, version: row.version, settings: row.settings, form: row.form};
    }) : [];
    // Contract §187.4: the brief's rosters follow the reading window of the scene in play, so a new window is a new brief.
    const window = object((binding as Row).brief_window);
    return fingerprint([sourceOf(binding), providers, ...(Object.keys(window).length ? [[window.first, window.last, window.chapters]] : [])]);
};
function payloadContains(value:unknown,content:string,seen=new Set<object>()):boolean {
    if(typeof value==='string')return value===content||value.includes(content);
    if(!value||typeof value!=='object'||seen.has(value as object))return false;seen.add(value as object);
    return (Array.isArray(value)?value:Object.values(value as Row)).some(child=>payloadContains(child,content,seen));
}

export function installContextPolicy(pi: ExtensionAPI, writeTelemetry: (row: Row) => void,
    workpadRoot?: () => string | undefined, materialScreen?:MaterialScreenPort): void {
    const nameWritingSupport=createWritingSupportNames();
    const requestJournal=createRequestJournal({currentInputOnly:process.env.PI_COC_TURN_PACKET_PROTOTYPE==='1'});
    const originalReads=createSnapshotReadCache();
    pi.on('session_start',()=>{requestJournal.reset();originalReads.clear();});
    pi.on('session_shutdown',()=>{requestJournal.reset();originalReads.clear();});
    pi.on('message_end',event=>requestJournal.complete(event.message as Row));
    pi.events.on('coc:keeper-response',(message:Row)=>requestJournal.complete(message,{privateReplay:true}));
    let expressionHistory:{campaign:string;turn:number;history:Row}|undefined;
    let observedTurn: number | undefined;
    const record = (row: Row): void => writeTelemetry({...(observedTurn === undefined ? {} : {turn: observedTurn}), ...row});
    let failedGeneration: number | undefined, inputPending = false;
    let call: KernelCall | undefined, campaign: string | undefined, capsule: Row | undefined, rawBinding: unknown;
    let locationDemand:{campaign:string;turn:number}|undefined;
    let locationRelevance:{key:string;promise:Promise<Row>}|undefined;
    let observationReferenceRead:{key:string;promise:Promise<Row|undefined>}|undefined;
    let locationIdentityRead:{key:string;promise:Promise<Row|undefined>}|undefined;
    const locationDetail=()=>!!locationDemand&&locationDemand.campaign===campaign&&locationDemand.turn===observedTurn;
    pi.events.on('coc:location-demand',(data:Row)=>{if(data.campaign===campaign&&Number.isSafeInteger(data.turn))locationDemand={campaign:data.campaign,turn:data.turn};});
    let materialSources:((turn:number)=>Row[])|undefined;
    let referenceReplyStatus:(()=>{campaign:string;turn:number;queued:boolean}|undefined)|undefined;
    let sourceRuntime:PrescreenSourceRuntime|undefined,moduleId:string|undefined;
    let answering: string[] | undefined, inputEpoch: string | undefined, generation = 0, prepared: Prepared | undefined;
    let preparing: Promise<Prepared | undefined> | undefined, brief: Row | undefined, briefKey: string | undefined;
    let lastFold: string | undefined, lastAttempt: string | undefined, lastDegraded: string | undefined;
    let lastReason = 'context_unavailable';
    let prescreenDeadlineAt=0,prescreenMemo:{key:string;message?:Row}|undefined,reusablePrescreen:Row|undefined;
    let prescreenProviderBudget=preparationProviderBudget();
    let providerSequence=0,pendingProvider:{requestId:string;prepared?:Row;outgoingDigest:string}|undefined;
    // Contract §135.6: on the single-loop engine the run's own read step is the prescreen. It announces itself, and
    // hands over the packet it prepared for the current turn; this hook then injects that packet and runs none of its own.
    let runOwnsPrescreen=false,singleKeeper=false,decisionAuthor=false,runPrescreen:{campaign:string;turn:number;message:Row}|undefined;
    // Contract §135.23: the turn's first capsule and first run packet, as the first request of the input sent them.
    // §184.2: `sent` is that capsule as the Keeper is sent it (stable sections first); `capsule` keeps the kernel's own copy.
    let turnMaterial:{epoch:string;capsule:Row;sent:Row;packet?:Row}|undefined;
    pi.events.on('coc:loop-engine',value=>{runOwnsPrescreen=object(value).prescreen==='run';singleKeeper=object(value).singleKeeper===true;decisionAuthor=object(value).turnPacketPrototype===true&&object(value).isolatedOutput===true;});
    pi.events.on('coc:run-prescreen',value=>{const packet=object(value);
        runPrescreen=typeof packet.campaign==='string'&&Number.isSafeInteger(packet.turn)&&packet.message?{campaign:packet.campaign,turn:packet.turn,message:object(packet.message)}:undefined;});
    let sessionEnv={...process.env},sharedAdapter:DecisionPort|undefined,sharedBudget:ReturnType<typeof preparationBudget>|undefined;
    let fallbackForInput=false,verifiedInputEpoch:string|undefined;
    let inputLifetime=new AbortController(),foregroundBudget:(()=>TaskProviderBudget|undefined)|undefined;
    let hybridReadOwner:(()=>Pick<TaskProviderBudget,'signal'|'deadlineAt'>|undefined)|undefined;
    const foregroundReadOwner=()=>foregroundBudget?.()??hybridReadOwner?.();
    const decision=()=>{
        if(!readJevApiKey(sessionEnv))return undefined;
        const capacity=Number(sessionEnv.PI_COC_JEV_CONCURRENCY??16);
        return sharedAdapter??=createDecisionAdapter({env:sessionEnv,maxConcurrency:Number.isInteger(capacity)&&capacity>0?Math.min(capacity,16):16});
    };
    const beginPreparationAllowance=()=>{
        const port=decision();
        if(fallbackForInput||!port||!campaign||!inputEpoch||prescreenDeadlineAt)return;
        const parent=foregroundBudget?.();
        prescreenDeadlineAt=Math.min(Date.now()+readJevPreselectAllowanceMs(sessionEnv),parent?.deadlineAt??Infinity);
        sharedBudget=preparationBudget({decision:port,campaign,deadlineAt:prescreenDeadlineAt,signal:inputLifetime.signal,parent});
        record({lane:'prescreen',owner:'keeper-preparation',event:'allowance_started',allowance_ms:readJevPreselectAllowanceMs(sessionEnv),
            effective_ms:Math.max(0,prescreenDeadlineAt-Date.now())});
    };
    const expression=createExpressionPreparation({read:async(method,params)=>call?call(method,params):undefined,decision:()=>singleKeeper?undefined:decision(),record});
    pi.events.on('coc:writing-reference-request',value=>{
        const request=object(value);
        if(request.campaign!==campaign||typeof request.accept!=='function'||!request.capsule)return;
        const supplied=request.capsule,binding=object(supplied._context);
        const previous=expressionHistory;
        const history=previous&&previous.campaign===campaign&&previous.turn===binding.turn?previous.history:undefined;
        const view={...supplied,...(history?{expression_exchange:history}:{})};
        expression.observe(view,binding,inputLifetime.signal);
        const owner=campaign,signal=inputLifetime.signal;
        request.accept((async()=>{
            await expression.waitForFirst(view,binding,signal);
            if(signal.aborted||owner!==campaign)return;
            const prepared=expression.project(view,binding),message=prepared&&rename([prepared])[0];
            if(!message)return;
            record({lane:'expression',event:'handoff',turn:binding.turn,destination:'output',bytes:requestSize([message])});
            return {campaign,turn:binding.turn,revision:message.details.expression.revision,content:String(message.content)};
        })());
    });
    // Contract §183.5: the indexed packages' sections this turn needs; the calls so far this turn are what triggers read.
    const modSections=createModSections({read:async(method,params)=>call?call(method,params):undefined,decision:()=>singleKeeper?undefined:decision(),record,
        // §248.4: the single Keeper has no topic judgement; state and calls push sections and the Keeper reads the rest.
        pull:()=>singleKeeper});
    const discoveryMode=()=>singleKeeper?'full':['selective','shadow'].includes(sessionEnv.COC_TURN_DISCOVERY??'')?sessionEnv.COC_TURN_DISCOVERY!:'full';
    // Both discovery stages reserve from the same preparation owner and its foreground parent.
    // A missing owner is a full-view fallback, never an independent provider allowance.
    const visibilityMode=()=>fallbackForInput?'full':discoveryMode();
    const discoveryDecision=()=>fallbackForInput?undefined:sharedBudget?.decision;
    // Contract §209.14: a purpose lookup comes after a Keeper inference, so its decision is owned by the current foreground
    // owner (TaskRuntime's provider owner, else the hybrid step's read owner), never by the optional allowance that inference
    // has usually outlived. One lease per owner; the capability runtime's per-input selector budget still bounds the work.
    let lookupBudget:{signal:AbortSignal;deadlineAt:number;budget:ReturnType<typeof preparationBudget>}|undefined;
    const closeLookupBudget=()=>{lookupBudget?.budget.close();lookupBudget=undefined;};
    const lookupDecision=():DecisionPort|string=>{
        const port=decision();
        if(!port||!campaign)return 'unconfigured';
        const owner=foregroundReadOwner();
        if(!owner||owner.signal.aborted||Date.now()>=owner.deadlineAt){
            closeLookupBudget();
            return !fallbackForInput&&sharedBudget&&Date.now()<prescreenDeadlineAt?sharedBudget.decision:'lookup_owner_unavailable';
        }
        if(lookupBudget?.signal!==owner.signal||lookupBudget.deadlineAt!==owner.deadlineAt){
            closeLookupBudget();
            const parent=foregroundBudget?.();
            lookupBudget={signal:owner.signal,deadlineAt:owner.deadlineAt,budget:preparationBudget({decision:port,campaign,deadlineAt:owner.deadlineAt,
                signal:parent?inputLifetime.signal:AbortSignal.any([inputLifetime.signal,owner.signal]),parent,
                owner:'capability-lookup',goal:'Answer the Keeper read-only capability purpose lookup'})};
        }
        return lookupBudget.budget.decision;
    };
    const capabilityRuntime=createCapabilityRuntime({tools:()=>offeredTools(COC_TOOLS,sessionEnv),decision:discoveryDecision,lookupDecision,mode:visibilityMode,view:discoveryMode,record});
    const modDiscovery=createModDiscovery({read:async(method,params)=>boundedDiscoveryRead(async()=>call?call(method,{campaign,...params}):undefined),
        decision:discoveryDecision,mode:visibilityMode,record});
    // §228.2: this input's disclosure (capability detail and package sections), sent once at a stable place.
    const disclosure=createTurnDisclosure();
    /** §228.3: what a write used before its detail was delivered, attached to that call's own result. */
    const attachments=new Map<string,{sections:string[];capabilities:string[];location:boolean}>();
    let pendingDiscovery:Row[]=[];
    const sectionKey=(key:string)=>'section:'+key,capabilityKey=(name:string)=>'capability:'+name;
    /** The sections a discovery packet carries, each with its key (the packet lists keys in the same order). */
    const sectionRows=(message:Row|undefined):Row[]=>{
        if(!message)return[];
        const keys:string[]=object(object(message.details).mod_sections).keys??[];
        let sections:Row[]=[];try{sections=object(JSON.parse(String(message.content))).sections??[];}catch{/* unreadable packet carries nothing */}
        return keys.map((key,index)=>({key,...object(sections[index])}));
    };
    /**
     * §228.4: the Keeper's `lookup {kind: "capability"}`. A name the package index lists reads that section; any other
     * name or a purpose query reads capability detail. What it returns is delivered with the result, once per input.
     */
    const discoveryLookup=async(args:Row):Promise<Row>=>{
        const name=typeof args.name==='string'?args.name.trim():'';
        const section=name?modDiscovery.find(name):undefined;
        if(section){
            const rows=await modDiscovery.sections([section.key]);
            disclosure.attached(rows.map(row=>sectionKey(row.key)));
            return{read_only:true,no_commit:true,package_sections:rows.map(({key:_key,...row})=>row)};
        }
        let result:Row;
        try{result=await capabilityRuntime.lookup(args);}
        catch(error){
            if(!name||!/Unknown capability name/.test(String((error as Error)?.message)))throw error;
            return{status:'not_found',read_only:true,no_commit:true,name,
                names:[...capabilityNames(),...modDiscovery.names()]};
        }
        const loaded=(Array.isArray(result.capabilities)?result.capabilities:[]).filter((c:Row)=>c.detail).map((c:Row)=>String(c.name));
        disclosure.attached(loaded.map(capabilityKey));
        return result;
    };
    // §248.4: the `mod` verb. A schema-1 indexed section by its listed name; the tool result stays in the run, outside
    // §228's disclosure. An unknown name answers with the names the table lists.
    const readModSection=async(name:string):Promise<Row>=>
        await modSections.read(name,campaign,object(capsule?.turn).number)
            ??{status:'not_found',read_only:true,no_commit:true,name,names:modSections.names()};
    const capabilityNames=()=>capabilityCatalogue(offeredTools(COC_TOOLS,sessionEnv)).filter(card=>card.verb==='apply').map(card=>card.name);
    let discoveryHandoff:Row|undefined;
    let discoveryUnavailable=false;
    pi.events.on('coc:discovery-task',value=>{discoveryHandoff=object(value);});
    // §215: the canonical gateway names who dispatched a call; a policy clerk's write is not the Keeper's decision.
    let hostOrigin:((toolCallId:string)=>unknown)|undefined;
    pi.events.on('coc:operation-dispatcher',value=>{const port=object(value);hostOrigin=typeof port.hostOrigin==='function'?port.hostOrigin as (id:string)=>unknown:undefined;});
    const temporalAdvice=createTemporalAdvice({read:async(method,params)=>call?call(method,params):undefined,decision,record});
    let pendingTemporal:Row|undefined;
    let turnCalls=emptyCalls(),pendingSections:Row|undefined;
    const resetPreparation=()=>{closeLookupBudget();fallbackForInput=false;verifiedInputEpoch=undefined;inputLifetime.abort();inputLifetime=new AbortController();sharedBudget?.close();sharedBudget=undefined;discoveryHandoff=undefined;discoveryUnavailable=false;};
    pi.events.on('coc:task-provider-budget',value=>{foregroundBudget=typeof value==='function'?value as typeof foregroundBudget:undefined;});
    pi.events.on('coc:discovery-read-owner',value=>{hybridReadOwner=typeof value==='function'?value as typeof hybridReadOwner:undefined;});
    // Contract §168.5: a capsule this hook reads itself is handed over through the kernel extension's first-sight view, as
    // the player-input capsule already was: an item whose check is still running is left out, and what is carried is noted.
    let firstSight:{campaign:string;view:(capsule:Row)=>Row}|undefined;
    // Contract §103.5: who is still untold, campaign-wide (`table.untold`), read with each snapshot; the last one read
    // renames every request, the degraded one included. §188.1: with the names the rename never touches a place of.
    // §194.1 (two ledgers, owner ruling 2026-10-08): the request carries the book's names as written; only the roster's
    // handle rows (machine text) are still shown as this table's word. The exit gate (§177.11, §177.15) keeps the names
    // from the player, so nothing here asks Jev about a place any more.
    let untoldRoster:UntoldRoster=NO_UNTOLD;
    const rename=<T,>(messages:readonly T[]):T[]=>renameHandles(messages,untoldRoster);
    pi.events.on('coc:first-sight',value=>{const port=object(value);
        firstSight=typeof port.campaign==='string'&&typeof port.view==='function'?port as unknown as typeof firstSight:undefined;});
    const firstSightView=(owner:string,view:Row):Row=>{
        if(firstSight?.campaign!==owner)return view;
        try{return object(firstSight.view(view));}catch{return view;}
    };
    let optionalWork = new AbortController();
    // Invalidating a snapshot must not disable its event subscriptions while rehydration waits.
    let observedWorkspaceMode: WorkspaceMode = 'off';
    const sourceCalls = new Set<string>();
    const stateCalls = new Set<string>();
    const reads = new Map<string, {kind: string; name?: string; query?: string}>();
    const evidenceNames = new Set<string>(), ruleNames = new Set<string>();
    const invalidate = (): void => {
        expression.reset();
        optionalWork.abort(); optionalWork = new AbortController();
        generation++; prepared = undefined; preparing = undefined;
    };
    const degraded = (reason: string): void => {
        requestJournal.reset();
        lastReason = reason;
        const key = `${generation}:${reason}`;
        if (key !== lastDegraded) {lastDegraded = key; record({lane: 'context', event: 'degraded', reason});}
    };
    pi.on('input', async () => {capabilityRuntime.clear();modDiscovery.clear();pendingDiscovery=[];disclosure.clear();attachments.clear();inputPending=true;turnCalls=emptyCalls();invalidate();});
    pi.events.on('coc:kernel-bridge', data => {
        const value = object(data), nextCall = typeof value.call === 'function' ? value.call : undefined;
        const nextCampaign = typeof value.campaign === 'string' ? value.campaign : undefined;
        const changed = call !== nextCall || campaign !== nextCampaign;
        call = nextCall; campaign = nextCampaign;
        materialSources=typeof value.materialSources==='function'?value.materialSources:undefined;
        referenceReplyStatus=typeof value.referenceReplyStatus==='function'?value.referenceReplyStatus:undefined;
        const runtime=object(value.runtime);
        // §191.6: the prescreen's consultation hands the pages it wanted and read natively to the transcript queue.
        sourceRuntime=typeof runtime.home==='string'&&typeof runtime.sourceInfo==='function'&&typeof runtime.sourceText==='function'
            ?{...runtime as unknown as PrescreenSourceRuntime,wantTranscripts:request=>pi.events.emit('coc:transcript-wanted',request)}:undefined;
        if (changed) {observedWorkspaceMode = 'off'; invalidate();}
    });
    pi.events.on('coc:table-open', data => {
        const opened=object(object(data).open),turn=object(opened.turn).number,campaignView=object(opened.campaign);
        if (Number.isSafeInteger(turn)) observedTurn = turn;
        moduleId=typeof campaignView.module_id==='string'?campaignView.module_id:typeof opened.module_id==='string'?opened.module_id:moduleId;
    });
    pi.events.on('coc:capsule', data => {
        const value = object(data);
        const previousEpoch=inputEpoch,nextEpoch=typeof value.epoch==='string'?value.epoch:undefined;
        const sameInput=singleKeeper&&previousEpoch!==undefined&&previousEpoch===nextEpoch;
        if(sameInput&&JSON.stringify(capsule)===JSON.stringify(value.capsule)&&JSON.stringify(rawBinding)===JSON.stringify(value.context))return;
        inputPending = false;
        capsule = value.capsule ? structuredClone(value.capsule) : undefined;
        rawBinding = value.context;
        observedWorkspaceMode = workspaceModeOf(object(rawBinding));
        if (Number.isSafeInteger(object(capsule?.turn).number)) observedTurn = object(capsule?.turn).number;
        inputEpoch = nextEpoch;
        if(previousEpoch!==nextEpoch){resetPreparation();prescreenDeadlineAt=0;prescreenProviderBudget=preparationProviderBudget();
            prescreenMemo=undefined;reusablePrescreen=undefined;}
        answering = Array.isArray(value.answering) ? value.answering.filter((entry: unknown) => typeof entry === 'string') : undefined;
        if(sameInput){generation++;prepared=undefined;preparing=undefined;}
        else{sourceCalls.clear();invalidate();}
        if(!sameInput&&capsule&&call&&campaign)expression.observe(capsule,{...object(rawBinding),campaign,turn:observedTurn??0},inputLifetime.signal);
        if(previousEpoch!==nextEpoch)turnCalls=emptyCalls();
        const sectionBinding=bindingOf(rawBinding);
        if(capsule&&call&&sectionBinding)modSections.observe(capsule,sectionBinding,inputLifetime.signal);
    });
    // Contract §41.1: the input was refused, so no turn opened and no capsule is coming to clear the latch
    // this input set. Nothing at the table moved either, so the held capsule and binding are still the last
    // ones the host published: undo the latch and let the next request prepare against them. Without this,
    // every request until the next accepted input runs degraded on `player_input_not_accepted`.
    pi.events.on('coc:input-refused', () => {inputPending = false; invalidate();});
    pi.events.on('coc:source-published', data => {
        if ((observedWorkspaceMode === 'off' && !prescreenEnabled() && !object(object(capsule?.mods).expression_reference).enabled
            &&discoveryMode()==='full') || object(data).campaign && object(data).campaign !== campaign) return;
        discoveryHandoff=undefined;
        // §217.1: a background publication lands inside the input, often while the Keeper's inference is out. It drops the
        // selected view (the next request reselects against the new source); the Keeper's lookups still answer for the input.
        capabilityRuntime.invalidate();modDiscovery.reset();
        expression.clear();
        capsule = undefined; rawBinding = undefined; brief = undefined; briefKey = undefined; prescreenMemo=undefined;reusablePrescreen=undefined; invalidate();
    });
    pi.on('tool_call', async event => {
        const input=object(event.input);
        noteCall(turnCalls,event.toolName,input);
        const effectKinds=applyEffectKinds(event.toolName,input);
        if(discoveryMode()!=='full'&&discoveryUnavailable&&['apply','resolve'].includes(event.toolName)){
            record({lane:'context',event:'write_held',turn:observedTurn,tool:event.toolName,reason:'discovery_unavailable',
                origin:object(hostOrigin?.(event.toolCallId)).origin==='policy'?'policy':'model',no_commit:true});
            return{block:true,reason:'The current discovery snapshot could not be verified. Refresh the canonical context before re-deciding this operation. No world change was committed. '+JSON.stringify({status:'unavailable',no_commit:true})};
        }
        const needed=(Array.isArray(object(capsule?.mods).instructions)?object(capsule?.mods).instructions:[])
            .filter((mod:Row)=>mod.index_contract_version===2)
            .flatMap((mod:Row)=>(mod.sections??[]).filter((section:Row)=>(section.triggers??[]).some((trigger:string)=>{
                const [kind,name]=trigger.split(':');
                return kind==='before_apply'&&effectKinds.includes(name)
                    ||kind==='before_resolve'&&event.toolName==='resolve'&&turnCalls.resolve.has(name);
            })).map((section:Row)=>section.key));
        if(capsule)modDiscovery.know(capsule);
        const missing=needed.filter((key:string)=>!disclosure.has(sectionKey(key)));
        // §228.3 (amends §209.6 and §215): a write is never held for detail it was not shown. Admission, Mod hooks and the
        // kernel still decide it; the detail it used undelivered rides on its own result, once for the input. A policy
        // clerk's write decides nothing from the Keeper's request, so nothing is attached to it.
        const hostWrite=object(hostOrigin?.(event.toolCallId)).origin==='policy';
        const capabilities=hostWrite?[]:capabilityRuntime.used(event.toolName,input).filter(name=>!disclosure.has(capabilityKey(name)));
        if(!hostWrite&&(missing.length||capabilities.length)){
            attachments.set(event.toolCallId,{sections:missing,capabilities,location:event.toolName==='place'||effectKinds.includes('place')});
            disclosure.owe([...missing.map(sectionKey),...capabilities.map(capabilityKey)]);
            record({lane:'turn-disclosure',event:'owed',turn:observedTurn,tool:event.toolName,keys:missing,capabilities,no_hold:true});
        }else if(hostWrite&&missing.length)record({lane:'mod-discovery',event:'readiness_deferred',turn:observedTurn,origin:'policy',tool:event.toolName,keys:missing});
        if (event.toolName === 'look' || event.toolName === 'lookup')
            reads.set(event.toolCallId, {kind: String(input.kind ?? input.focus ?? ''),
                name: typeof input.name === 'string' ? input.name : undefined,
                query: typeof input.query === 'string' ? input.query : undefined});
        if (['apply', 'resolve', 'narrate', 'ask'].includes(event.toolName)||effectKinds.includes('place')) stateCalls.add(event.toolCallId);
        noteCall(turnCalls, event.toolName, input);
        if (event.toolName === 'lookup' && input.kind === 'source'
            || event.toolName === 'apply' && Array.isArray(input.effects) && input.effects.some((effect: Row) => effect.kind === 'adaptation'))
            sourceCalls.add(event.toolCallId);
    });
    // §228.3: the detail a write used undelivered rides on that write's own result, whatever it was, once per input.
    const attachDisclosure=async(event:ToolResultEvent)=>{
        const owed=attachments.get(event.toolCallId);
        if(!owed)return;
        attachments.delete(event.toolCallId);
        const keys=owed.sections.filter(key=>!disclosure.has(sectionKey(key)));
        const names=owed.capabilities.filter(name=>!disclosure.has(capabilityKey(name)));
        let rows:Row[]=[];
        if(keys.length)try{rows=await modDiscovery.sections(keys);}
        catch(error){record({lane:'turn-disclosure',event:'attach_unavailable',turn:observedTurn,keys,reason:String((error as Error)?.message??error).slice(0,160)});}
        const detail=names.length?capabilityDetail(offeredTools(COC_TOOLS,sessionEnv),names):[];
        if(!rows.length&&!detail.length)return;
        const text=JSON.stringify({kind:'disclosed_detail',authority:ATTACHED_AUTHORITY,
            ...(rows.length?{package_sections:rows.map(({key:_key,...row})=>row)}:{}),
            ...(detail.length?{capability_detail:detail}:{})});
        disclosure.attached([...rows.map(row=>sectionKey(row.key)),...detail.map(card=>capabilityKey(card.name))]);
        record({lane:'turn-disclosure',event:'attached',turn:observedTurn,tool:event.toolName,is_error:event.isError,
            keys:rows.map(row=>row.key),capabilities:detail.map(card=>card.name),bytes:Buffer.byteLength(text)});
        return{content:[...event.content,{type:'text' as const,text}],...(owed.location?{details:{...object(event.details),location_disclosure:{turn:observedTurn,index:event.content.length,package:capsule?.mods?.location_context?.mod}}}:{})};
    };
    pi.on('tool_result',async event=>{
        const attached=await attachDisclosure(event);
        await observeResult(event);
        return attached;
    });
    pi.events.on('coc:final-delivery',(frame:any)=>{
        if(frame?.event==='end'&&frame.status==='completed'){inputLifetime.abort();expression.reset();}
    });
    const observeResult=async(event:ToolResultEvent)=>{
        const read = reads.get(event.toolCallId); reads.delete(event.toolCallId);
        let captured = false;
        if (read && !event.isError && (observedWorkspaceMode !== 'off' || prescreenEnabled())) {
            const result = object(event.details);
            const remember = (set: Set<string>, name: unknown) => {
                if (typeof name !== 'string' || !name || name.length > 200) return;
                set.delete(name); set.add(name); while (set.size > 16) set.delete(set.values().next().value!);
                captured = true;
            };
            for (const entity of Array.isArray(result.entities) ? result.entities : []) remember(evidenceNames, object(entity).name);
            for (const rule of Array.isArray(result.rules) ? result.rules : []) remember(ruleNames, object(rule).name);
            if (read.kind === 'npc' || read.kind === 'module') remember(evidenceNames, read.name ?? read.query);
        }
        if (event.toolName === 'resolve' && !event.isError) noteCall(turnCalls, 'resolve', object(event.input), object(event.details));
        const stateChanged = stateCalls.delete(event.toolCallId);
        const sourceChanged = sourceCalls.delete(event.toolCallId);
        const deliveredTurn=stateChanged&&!event.isError&&object(event.details).checked!==true
            &&(['narrate','ask','output'].includes(event.toolName)||object(event.details).narrate_in_apply===true);
        if(deliveredTurn){inputLifetime.abort();expression.reset();}
        // A failed transport can hide a committed mutation. Re-read the actual kernel state;
        // never infer arrival or settlement from the requested effect or an error flag.
        const expressionRefresh=stateChanged&&!deliveredTurn&&!!readJevApiKey(sessionEnv)&&object(object(capsule?.mods).expression_reference).enabled;
        if (!sourceChanged && !captured && !(stateChanged && (observedWorkspaceMode !== 'off' || prescreenEnabled() || expressionRefresh||discoveryMode()!=='full'))) return;
        capsule = undefined; rawBinding = undefined; brief = undefined; briefKey = undefined; invalidate();
    };
    pi.on('session_start', async () => {capabilityRuntime.clear();modDiscovery.clear();pendingDiscovery=[];disclosure.clear();attachments.clear();pi.events.emit?.('coc:capability-discovery',{lookup:discoveryLookup});pi.events.emit?.('coc:mod-sections',{read:readModSection});temporalAdvice.clear();pendingTemporal=undefined;expression.clear();modSections.clear();pendingSections=undefined;turnCalls=emptyCalls();resetPreparation();untoldRoster=NO_UNTOLD;turnMaterial=undefined;sessionEnv={...process.env};sharedAdapter=undefined;invalidate(); observedWorkspaceMode = 'off'; inputPending = false; brief = undefined; briefKey = undefined; lastFold = undefined;
        lastAttempt = undefined; sourceCalls.clear(); stateCalls.clear();prescreenDeadlineAt=0;prescreenMemo=undefined;reusablePrescreen=undefined;
        prescreenProviderBudget=preparationProviderBudget();});
    pi.on('session_shutdown', async () => {capabilityRuntime.clear();modDiscovery.clear();pendingDiscovery=[];disclosure.clear();attachments.clear();pi.events.emit?.('coc:capability-discovery',{});pi.events.emit?.('coc:mod-sections',{});temporalAdvice.clear();pendingTemporal=undefined;expression.clear();modSections.clear();pendingSections=undefined;turnCalls=emptyCalls();resetPreparation();untoldRoster=NO_UNTOLD;sharedAdapter=undefined;call=undefined;capsule=undefined;rawBinding=undefined;sourceRuntime=undefined;moduleId=undefined;observedWorkspaceMode='off';
        prescreenMemo=undefined;reusablePrescreen=undefined;pendingProvider=undefined;prescreenDeadlineAt=0;
        prescreenProviderBudget={actions:0,inputTokens:0,outputTokens:0,costUsd:0};invalidate();});

    async function prepare(): Promise<Prepared | undefined> {
        if (inputPending) {failedGeneration = generation; degraded('player_input_not_accepted'); return undefined;}
        if (failedGeneration === generation) return undefined;
        if (prepared) return prepared;
        if (preparing) return preparing;
        const ticket = generation, bridge = call, owner = campaign, signal = optionalWork.signal;
        const fail = (reason: string): undefined => {
            if (ticket === generation) {failedGeneration = ticket; degraded(reason);}
            return undefined;
        };
        if (!bridge || !owner) return fail('kernel_bridge_unavailable');
        preparing = (async () => {
            const began = Date.now();
            let binding = bindingOf(rawBinding), current = capsule;
            let rehydrated = false, reads = 0, readBytes = 0, originalReadHits=0;
            const acceptedEpoch=inputEpoch;
            const hostView=(read:Row):Row=>{
                const prior=singleKeeper&&acceptedEpoch!==undefined&&acceptedEpoch===inputEpoch
                    ?current??(turnMaterial?.epoch===inputEpoch?turnMaterial.capsule:undefined):undefined;
                return {...Object.fromEntries(['skills','delivery_recovery'].filter(key=>!Object.hasOwn(read,key)&&Object.hasOwn(object(prior),key)).map(key=>[key,prior?.[key]])),...read};
            };
            const rpc = async (method: string, params: Row): Promise<Row> => object(await bridge(method, {campaign: owner, ...params}));
            try {
                if (!binding || !current) {
                    const result = await rpc('table.capsule', {rehydrate: true});
                    if (ticket !== generation || signal.aborted) return undefined;
                    const {_context, ...read} = result, view = firstSightView(owner, hostView(read));
                    binding = bindingOf(_context); current = view;
                    if (!binding) return fail('context_binding_unavailable');
                    rawBinding = _context; capsule = view; rehydrated = true;
                    expression.observe(view,{...object(_context),campaign:owner,turn:observedTurn??0},inputLifetime.signal);
                }
                // §103.5: read with the snapshot, so a turn's every request renames by the same roster; a failed read keeps the last.
                // §177.4 (table 25): a failed read was silent, so a name the Keeper wrote could not be told apart from a rename
                // that never ran; the failure and the roster's size are recorded with the turn.
                let untoldFailed: string | undefined;
                try { untoldRoster = readUntold(await rpc('table.untold', {})); }
                catch (error) { untoldFailed = error instanceof Error ? error.message.slice(0, 160) : 'untold read failed'; }
                if (ticket !== generation || signal.aborted) return undefined;
                const source = briefingKey(binding, current);
                if (!brief || briefKey !== source) {
                    let full = current;
                    if (!rehydrated) {
                        const result = await rpc('table.capsule', {rehydrate: true});
                        if (ticket !== generation || signal.aborted) return undefined;
                        const {_context, ...read} = result, view = firstSightView(owner, hostView(read));
                        const actual = bindingOf(_context);
                        if (!actual || actual.campaign !== binding.campaign || actual.worldline !== binding.worldline
                            || actual.loop !== binding.loop || actual.turn !== binding.turn) return fail('rehydration_binding_changed');
                        // A reader may publish the book between player_input and this readonly hydration.
                        binding = actual; rawBinding = _context; current = view; capsule = view;
                        full = view; rehydrated = true;
                        expression.observe(view,{...object(_context),campaign:owner,turn:observedTurn??0},inputLifetime.signal);
                    }
                    brief = {kind: 'context_brief', head: decisionAuthor
                        ? 'Keeper-only current book and decision instructions. Prose craft belongs to the sole author. Use with the current turn capsule; this is not player input.'
                        : 'Keeper-only current book, full craft context and active package instructions. Use with the current turn capsule; this is not player input.',
                        // §183.5: the rows' text only. An indexed row's section list and its per-turn gates stay out, so this stays cached.
                        module: full.module ?? null, style: full.style ?? null, instructions: (Array.isArray(object(full.mods).instructions) ? object(full.mods).instructions : [])
                            .map((value: Row) => ({mod: value.mod, version: value.version, settings: value.settings, form: value.form, instruction: value.instruction})),
                        // §248.3: what the topic ids of the indexed rows' section index mean.
                        ...(Array.isArray(object(full.mods).topics) && object(full.mods).topics.length
                            ? {topics: object(full.mods).topics.map((topic: Row) => ({id: topic.id, what: topic.what}))} : {}),
                        truncated: Array.isArray(full.truncated) ? full.truncated.filter((section: string) => ['module', 'style'].includes(section)) : []};
                    briefKey = briefingKey(binding, full);
                }
                const quotes: Quote[] = [];
                let unavailable: string | undefined;
                const turns = [...new Set((Array.isArray(current.recent) ? current.recent : []).map((entry: Row) => entry.turn)
                    .filter((turn: unknown): turn is number => Number.isSafeInteger(turn) && Number(turn) < binding!.turn))].sort((a, b) => Number(a) - Number(b)).slice(-2) as number[];
                const wanted = turns.length ? turns : [binding.turn - 2, binding.turn - 1].filter(turn => turn >= 0);
                const recall = async (params: Row): Promise<Row> => {
                    const loaded=await originalReads.read(sourceOf(binding!),params,
                        ()=>rpc('table.recall', {...params, _context_read: true}));
                    if(loaded.reused)originalReadHits++;
                    else{reads++;readBytes+=sizeOf(loaded.value);}
                    return loaded.value;
                };
                if (wanted.length) try {
                    const cards: Row[] = [];
                    let transcriptSnapshot: string | undefined;
                    for (const turn of [...wanted].reverse()) {
                        const listed = await recall({what: 'transcript', turns: [turn, turn]});
                        if (!Array.isArray(listed.cards) || typeof listed._snapshot !== 'string') throw new Error('Transcript cards are unavailable');
                        if (transcriptSnapshot && transcriptSnapshot !== listed._snapshot) throw new Error('Historical source changed during context preparation');
                        transcriptSnapshot = listed._snapshot;
                        cards.push(...listed.cards.map((card: Row) => ({...card, _snapshot: listed._snapshot})));
                    }
                    const pending: Array<{quote: Quote; request?: Row}> = [];
                    const takePage = async (item: {quote: Quote; request?: Row}, limit?: number): Promise<void> => {
                        const request = limit ? {...item.request!, read: {...item.request!.read, limit}} : item.request!;
                        const result = await recall(request);
                        if (typeof result.text !== 'string' || result.range?.offset !== Array.from(item.quote.text).length) throw new Error('Original text pages are not contiguous');
                        item.quote.text += result.text; item.quote.total_chars = result.total_chars;
                        item.quote.verified = item.quote.verified && result.verified === true;
                        item.request = result.next ? {...result.next, _snapshot: result._snapshot} : undefined;
                    };
                    // Reserve a first page for both sides before a very long utterance spends the read budget.
                    for (const card of cards) {
                        if (!card.read || !['player', 'keeper'].includes(card.role)) continue;
                        const item = {quote: {turn: card.turn, role: card.role, text: '', total_chars: Number(card.chars), verified: true, read: card.read} as Quote,
                            request: {...card.read, _snapshot: card._snapshot} as Row | undefined};
                        await takePage(item); pending.push(item); quotes.push(item.quote);
                    }
                    const newest = Math.max(...wanted);
                    for (const turn of [...wanted].sort((a, b) => b - a)) {
                        while (readBytes < HISTORY_BYTES * 2) {
                            const candidates = pending.filter(item => item.request && item.quote.turn === turn)
                                .sort((a, b) => sizeOf(a.quote.text) - sizeOf(b.quote.text));
                            const priority = turn === newest ? quotes.filter(quote => quote.turn === newest) : quotes;
                            const completeView = {...metadata(binding), quotes: priority.map(quote => quoteView(quote)), earlier_than: turn};
                            if (!candidates.length || sizeOf(completeView) >= HISTORY_BYTES) break;
                            // Smaller continuation pages share remaining space between the two speakers.
                            await takePage(candidates[0], 1024);
                        }
                    }
                } catch (error) {unavailable = error instanceof Error ? error.message.slice(0, 160) : 'Original records are unavailable';}
                if (ticket !== generation) return undefined;
                const history = historyView(binding, quotes, unavailable);
                expressionHistory={campaign:binding.campaign,turn:binding.turn,history};
                expression.observe({...current,expression_exchange:history},binding,inputLifetime.signal);
                // KIC-03 (contract §19.2): the optional workspace follows host preferences.
                // Off, unknown or missing reads nothing; shadow reads and records only;
                // on injects. Any failure here is a miss on the optional layer, never a degraded turn.
                const workspaceMode = workspaceModeOf(object(rawBinding)), workspaceBudget = workspaceBudgetOf(object(rawBinding));
                observedWorkspaceMode = workspaceMode;
                let workspace: Row | undefined;
                if (workspaceMode !== 'off' && !prescreenEnabled()) {
                    const began = Date.now();
                    try {
                        const settings = workspaceSettingsOf(object(rawBinding));
                        const dormantLimit = Math.min(32, Math.floor(settings.candidates / 4));
                        const snapshot = await rpc('table.workspace.read', {query: String(object(current.turn).player_text ?? ''),
                            names: [...evidenceNames], rules: [...ruleNames], candidate_limit: settings.candidates - dormantLimit});
                        if (ticket !== generation) return undefined;
                        let candidates = workspaceCandidates(snapshot, binding).slice(0, settings.candidates);
                        let cacheRoot: string | undefined;
                        try {cacheRoot = workpadRoot?.();} catch { /* Cache availability never gates the snapshot. */ }
                        if (cacheRoot && dormantLimit && workspaceCandidates(snapshot, binding).length) {
                            const dormant = await dormantEvidence(join(dirname(cacheRoot), 'evidence'), snapshot, dormantLimit, signal);
                            if (ticket !== generation || signal.aborted) return undefined;
                            // Fresh metadata for a locator always wins. Dormant scene/entity bodies
                            // extend the pool before ranking; they never replace current state.
                            const fresh = new Map(candidates.map(ref => [ref.locator, ref]));
                            const raw = object(snapshot.candidates), manifest = object(snapshot.manifest);
                            const known = new Set([...(Array.isArray(raw.static) ? raw.static : Array.isArray(manifest.static) ? manifest.static : []),
                                ...(Array.isArray(raw.records) ? raw.records : Array.isArray(manifest.records) ? manifest.records : [])]
                                .map(ref => object(ref).locator));
                            const restored = dormant.filter(ref => !known.has(ref.locator) || fresh.has(ref.locator))
                                .map(ref => fresh.get(ref.locator) ?? ref);
                            const seen = new Set<string>();
                            candidates = [...candidates.slice(0, 4), ...restored, ...candidates]
                                .filter(ref => {if (seen.has(ref.locator)) return false; seen.add(ref.locator); return true;})
                                .slice(0, settings.candidates);
                            record({lane: 'workspace-evidence', event: 'dormant', restored: dormant.length,
                                inspection_budget: settings.candidates, cache_budget: dormantLimit});
                        }
                        candidates = candidates.map((candidate, priority) => ({...candidate, priority}));
                        snapshot.candidates = {static: candidates.filter(ref => ref.authority !== 'table_record'), records: candidates.filter(ref => ref.authority === 'table_record')};
                        const query = String(object(current.turn).player_text ?? '');
                        const deterministic = selectWorkspace({snapshot, binding, budget: workspaceBudget});
                        const fits = deterministic.status === 'selected'
                            && deterministic.counts.omitted.static.budget + deterministic.counts.omitted.records.budget === 0;
                        const rerank = workspaceMode === 'shadow' || !settings.rerank || !settings.remote || fits
                            ? {status: 'skipped' as const, reason: workspaceMode === 'shadow' ? 'shadow' : !settings.rerank ? 'disabled' : !settings.remote ? 'permission' : 'fits'}
                            : await rankWorkspaceCandidates({query, candidates, signal, maxCandidates: settings.rankCandidates,
                                binding: snapshot.binding});
                        if (ticket !== generation || signal.aborted) return undefined;
                        if (rerank.status !== 'skipped') record({lane: 'workspace-rerank', event: rerank.status,
                            reason: rerank.status === 'fallback' ? rerank.reason : undefined, candidates: rerank.candidates,
                            ms: rerank.ms, ...('provider' in rerank && rerank.provider ? {provider: rerank.provider} : {}),
                            ...('model' in rerank && rerank.model ? {model: rerank.model} : {})});
                        else record({lane: 'workspace-rerank', event: 'skipped', reason: rerank.reason});
                        // KIC-04: the Keeper's own published workpad joins the same selection. Any
                        // failure here — root, store, corrupt file — is a miss on the optional layer,
                        // never a degraded selection and never a degraded request.
                        let workpad: WorkpadView | undefined;
                        try {
                            const root = workpadRoot?.();
                            if (root && settings.workpad) {
                                const read = await createWorkpadStore(root)
                                    .read({campaign: binding.campaign, worldline: binding.worldline, loop: binding.loop,
                                        ...(typeof object(snapshot.binding).scene === 'string' && object(snapshot.binding).scene
                                            ? {scene: object(snapshot.binding).scene} : {})});
                                if (read.status === 'ok') workpad = read.view;
                            }
                        } catch { workpad = undefined; }
                        if (ticket !== generation || signal.aborted) return undefined;
                        const selection = selectWorkspace({snapshot, binding, budget: workspaceBudget, workpad,
                            ...(rerank.status === 'ranked' || rerank.status === 'cache' || rerank.status === 'fallback'
                                ? {rankedLocators: rerank.order} : {})});
                        if (selection.status === 'selected') {
                            workspace = selection.message;
                            if (cacheRoot) {
                                const view = JSON.parse(String(workspace.content));
                                const selectedNames = new Set(view.evidence.map((ref: Row) => ref.locator));
                                const reused = await reuseEvidence(join(dirname(cacheRoot), 'evidence'), snapshot, candidates.filter(ref => selectedNames.has(ref.locator)), signal);
                                if (ticket !== generation || signal.aborted) return undefined;
                                const restored = new Map(reused.candidates.map(ref => [ref.locator, ref]));
                                view.evidence = view.evidence.map((ref: Row) => typeof restored.get(ref.locator)?.body === 'string'
                                    ? {...ref, body: restored.get(ref.locator)!.body} : ref);
                                workspace = {...workspace, content: JSON.stringify(view)};
                                record({lane: 'workspace-evidence', valid: candidates.length, selected: view.evidence.length,
                                    hits: reused.hits, stored: reused.stored, misses: reused.misses});
                            }
                            record({lane: 'workspace', event: workspaceMode === 'shadow' ? 'shadow' : 'selected', mode: workspaceMode,
                                packed_static: selection.counts.packed.static, packed_records: selection.counts.packed.records,
                                filtered_static: selection.counts.filtered.static, filtered_records: selection.counts.filtered.records,
                                omitted_static_manifest: selection.counts.omitted.static.manifest, omitted_records_manifest: selection.counts.omitted.records.manifest,
                                omitted_static_budget: selection.counts.omitted.static.budget, omitted_records_budget: selection.counts.omitted.records.budget,
                                workpad_entries: selection.counts.workpad.packed, workpad_omitted: selection.counts.workpad.omitted,
                                truncated: selection.counts.truncated, bytes: sizeOf(workspace), budget_bytes: workspaceBudget, ms: Date.now() - began});
                        } else record({lane: 'workspace', event: 'omitted', mode: workspaceMode, reason: selection.reason, ms: Date.now() - began});
                    } catch (error) {
                        record({lane: 'workspace', event: 'omitted', mode: workspaceMode, reason: 'workspace_read_failed',
                            detail: error instanceof Error ? error.message.slice(0, 160) : 'Unknown workspace read error'});
                    }
                }
                if (ticket !== generation || signal.aborted) return undefined;
                prepared = {binding, capsule: current, history, brief: brief!, key: epochOf(binding), answering, workspace, workspaceMode};
                record({lane: 'context', event: 'prepared', version: POLICY_VERSION, turn: binding.turn,
                    history_bytes: sizeOf(history), briefing_bytes: sizeOf(brief), source_revision: binding.source_revision,
                    read_calls: reads, read_bytes: readBytes, original_read_cache_hits:originalReadHits, rehydrated, ms: Date.now() - began, untold_rows: untoldRoster.people.length, untold_protected: untoldRoster.protected.length,
                    ...(untoldFailed ? {untold_failed: untoldFailed} : {}), ...(unavailable ? {history_unavailable: true} : {})});
                return prepared;
            } catch (error) {
                if (ticket === generation) record({lane: 'context', event: 'prepare_failed', detail: error instanceof Error ? error.message.slice(0, 160) : 'Unknown context preparation error'});
                return fail('context_prepare_failed');
            } finally {
                if (ticket === generation) preparing = undefined;
            }
        })();
        return preparing;
    }

    const diagnostic = (reason: string, note = reason === 'latest_tool_batch_omitted'
        ? 'The latest complete tool-result batch was not sent because it could not fit this request. Do not repeat that oversized batch. Retrieve only the next missing body you need, use its result, then decide whether another read is necessary. Independent reads may still run together when they fit. Preserve authoritative state and pending choices; do not invent omitted results. This is host capacity information, not a story event or a new obligation.'
        : 'Some context was omitted or retained within the request limit. Preserve authoritative state and pending choices; do not invent missing history. This host notice is not a story event or a new obligation.'): Row => customMessage(DIAGNOSTIC_TYPE, {
        kind: 'context_diagnostic', reason, note,
    });
    // Contract §209.13: package detail the request could not carry is omitted whole and said so.
    const PACKAGE_OMITTED_NOTE = 'Required package instructions could not be sent with this request and were omitted, not shortened. Writes that need them stay held until a request carries them; do not invent their content. This host notice is not a story event or a new obligation.';
    const PACKAGE_OMISSIONS = new Set(['mod_discovery_capacity', 'mod_discovery_detail_unavailable']);
    /** The serialized system head and tool declarations Pi restores after this hook (Pi 0.87). */
    const systemMeasure = (ctx: ExtensionContext): {systemBytes: number; systemDigest: string | null} => {
        if (typeof ctx.sessionManager?.buildSessionProjection === 'function') {
            const system = getCurrentSystemMessage(ctx.sessionManager.buildSessionProjection().messages);
            // §184.3: the prompt text and the tool declarations the provider sees; the transcript timestamp is not sent.
            const measured=system?{...system,toolsAdded:locationToolDeclarations(capabilityRuntime.project(system.toolsAdded??[])??system.toolsAdded??[],locationDetail())}:undefined;
            return {systemBytes: measured ? sizeOf(measured) + 1 : 0,
                systemDigest: measured ? shortDigest({content: measured.content, sections: measured.sections ?? null, tools: measured.toolsAdded}) : null};
        }
        const active = typeof pi.getActiveTools === 'function' ? new Set(pi.getActiveTools()) : undefined;
        const tools = typeof pi.getAllTools === 'function' ? pi.getAllTools().filter(tool => !active || active.has(tool.name)) : [];
        const material = {system: typeof ctx.getSystemPrompt === 'function' ? ctx.getSystemPrompt() : '', tools:locationToolDeclarations(capabilityRuntime.project(tools)??tools,locationDetail())};
        return {systemBytes: sizeOf(material), systemDigest: shortDigest(material)};
    };
    const discoveryEvidence=(messages:readonly Row[])=>messages.filter(message=>message.role!=='custom'
        ||!['coc-capsule',BRIEF_TYPE,MOD_SECTIONS_MESSAGE,EXPRESSION_MESSAGE,TEMPORAL_ADVICE_MESSAGE,
            PRESCREEN_TYPE,WORKSPACE_TYPE,CAPSULE_UPDATE_TYPE,CLERK_TYPE].includes(message.customType));
    /**
     * §219.4: the owner a required discovery read runs under. After a verified request, §209.9 hands required hydration and
     * identity checks to the foreground owner once the optional allowance expires; the pin happens at the next request,
     * so a request whose projection was already under way when the allowance ran out (4d7 turn 88: prepared at 0.6 s
     * before expiry, its package detail read 0.1 s after) keeps that same foreground owner for its reads instead of failing
     * the whole projection. An unverified input keeps the shared preparation deadline.
     */
    const discoveryReadOwner=()=>{
        const parent=foregroundReadOwner(),verified=!!parent&&!!inputEpoch&&verifiedInputEpoch===inputEpoch;
        // Never shorter than the optional allowance the read would have had: the foreground owner only extends it.
        const foreground=fallbackForInput||verified&&!!prescreenDeadlineAt&&parent!.deadlineAt>prescreenDeadlineAt;
        return {parent,deadline:foreground?parent?.deadlineAt:prescreenDeadlineAt,
            expired:foreground?'discovery_foreground_deadline':'discovery_snapshot_deadline',
            owner:fallbackForInput||foreground&&!!prescreenDeadlineAt&&Date.now()>=prescreenDeadlineAt?'foreground_fallback':'preparation'};
    };
    async function boundedDiscoveryRead<T>(read:()=>Promise<T>):Promise<T>{
        if(discoveryMode()==='full'||!prescreenDeadlineAt)return read();
        const {parent,deadline,expired}=discoveryReadOwner();
        if(!deadline)throw Error('discovery_foreground_unavailable');
        const remaining=deadline-Date.now();
        if(remaining<=0)throw Error(expired);
        const lifetime=AbortSignal.any([inputLifetime.signal,optionalWork.signal,
            ...(parent?[parent.signal]:[]),AbortSignal.timeout(remaining)]);
        return new Promise<T>((resolve,reject)=>{
            const abort=()=>reject(Error(Date.now()>=deadline?expired:'discovery_snapshot_cancelled'));
            if(lifetime.aborted){abort();return;}
            lifetime.addEventListener('abort',abort,{once:true});
            void Promise.resolve().then(read).then(value=>{lifetime.removeEventListener('abort',abort);resolve(value);},
                error=>{lifetime.removeEventListener('abort',abort);reject(error);});
        });
    }
    /**
     * No capsule, or a projection that failed, means no projection, never an unbounded request: a long campaign's
     * whole stored branch is exactly what must not reach the provider on a degraded turn.
     */
    function degradedRequest(requestMessages: Row[], ctx: ExtensionContext, reason: string, failure?: string): Row[] {
        const {systemBytes, systemDigest} = systemMeasure(ctx);
        const ceiling = requestBudget(ctx.model?.contextWindow), budget = Math.max(0, ceiling - systemBytes);
        // §176.8: renamed before the cut, so the ceiling measures the names and notes that go out.
        const evidence=discoveryMode()==='full'?requestMessages:discoveryEvidence(requestMessages);
        const rest = rename(evidence.filter(message => !(message.role === 'custom' && [DIAGNOSTIC_TYPE, PRESCREEN_TYPE].includes(message.customType)))
            .map(message=>keeperCapsuleMessage(message,decisionAuthor)));
        const notice = diagnostic(reason);
        const cut = boundedTail(rest, Math.max(0, budget - requestSize([notice])));
        const outgoing = rename([notice, ...cut.messages]);
        record({lane: 'context', event: 'request', at: new Date().toISOString(), version: POLICY_VERSION, reason,
            ...(failure ? {error: failure} : {}),
            request_bytes: requestSize(outgoing) + systemBytes, system_bytes: systemBytes, system_digest: systemDigest, ...requestSegments(outgoing),
            local_token_estimate: Math.ceil((requestSize(outgoing) + systemBytes) / BYTES_PER_TOKEN),
            ceiling_bytes: ceiling, dropped_tail: cut.dropped, context_window: ctx.model?.contextWindow ?? null,
            ...(cut.over ? {capacity: 'request_ceiling_exceeded'} : {})});
        return outgoing;
    }
    // Contract §209.13: Pi keeps the messages a `context` handler was given when it throws, and for this hook those are
    // the whole stored branch. So nothing thrown leaves it: any failure is answered with the bounded degraded request.
    pi.on('context', async (event, ctx) => {
        try {return await projectRequest(event, ctx);}
        catch (error) {
            const failure = (error instanceof Error ? error.message : String(error)).slice(0, 160);
            discoveryUnavailable=discoveryMode()!=='full';capabilityRuntime.invalidate();modDiscovery.reset();pendingDiscovery=[];
            pendingSections=undefined;pendingTemporal=undefined;pendingProvider=undefined;
            invalidate();degraded('context_projection_failed');
            const requestMessages=event.messages.filter(message=>message.role!=='custom'||message.customType!==NPC_ADVICE_TYPE);
            try {return {messages: degradedRequest(requestMessages as unknown as Row[], ctx, 'context_projection_failed', failure) as typeof requestMessages};}
            catch {return {messages: [diagnostic('context_projection_failed')] as unknown as typeof requestMessages};}
        }
    });
    async function projectRequest(event: ContextEvent, ctx: ExtensionContext): Promise<ContextEventResult> {
        const ticket = generation;
        // Optional expiry stops discovery; a verified input can still use its existing core owner for fresh reads.
        if(!fallbackForInput&&inputEpoch&&verifiedInputEpoch===inputEpoch&&prescreenDeadlineAt
            &&Date.now()>=prescreenDeadlineAt&&foregroundReadOwner()){
            fallbackForInput=true;discoveryUnavailable=true;sharedBudget?.close();sharedBudget=undefined;
            capabilityRuntime.invalidate();modDiscovery.reset();pendingDiscovery=[];
            record({lane:'context',event:'discovery_fallback',turn:observedTurn,reason:'preparation_expired',
                optional_deadline:prescreenDeadlineAt,foreground_deadline:foregroundReadOwner()?.deadlineAt});
        }
        // Start before storage hydration so its elapsed time is not a free selection allowance.
        if(discoveryMode()!=='full')beginPreparationAllowance();
        // §143.6: NPC advice is retired; a copy a session recorded before that never reaches the model.
        const requestMessages=event.messages.filter(message=>message.role!=='custom'||message.customType!==NPC_ADVICE_TYPE)
            .map(message=>keeperCapsuleMessage(message as Row,decisionAuthor));
        let snapshot:Prepared|undefined;
        // A concurrent input may replace a generation while its optional work is awaiting I/O.
        // Try the current accepted binding once; an unaccepted input uses the normal fallback.
        try{
            snapshot=await boundedDiscoveryRead(prepare);
            if(!snapshot&&ticket!==generation&&!inputPending)snapshot=await boundedDiscoveryRead(prepare);
        }catch(error){
            if(ticket===generation){discoveryUnavailable=discoveryMode()!=='full';capabilityRuntime.invalidate();modDiscovery.reset();pendingDiscovery=[];
                invalidate();degraded(String(error?.message??'discovery_snapshot_unavailable'));}
        }
        if(!snapshot&&ticket===generation){discoveryUnavailable=discoveryMode()!=='full';capabilityRuntime.invalidate();modDiscovery.reset();pendingDiscovery=[];}
        let observationReference:Row|undefined,locationIdentity:Row|undefined;
        if(snapshot?.capsule.mods?.location_context&&ticket===generation&&!inputLifetime.signal.aborted&&snapshot.binding.campaign===campaign&&snapshot.binding.turn===observedTurn){
            const key=JSON.stringify([snapshot.binding.campaign,snapshot.binding.turn,sourceOf(snapshot.binding)]);
            const reused=locationRelevance?.key===key;
            if(!reused)locationRelevance={key,promise:locationContextRelevance(snapshot.capsule,snapshot.binding,decision(),inputLifetime.signal,foregroundBudget?.())};
            const relevance=await locationRelevance.promise;
            if(ticket===generation&&!inputLifetime.signal.aborted&&snapshot.binding.campaign===campaign&&snapshot.binding.turn===observedTurn){
                if(relevance.needed){(turnCalls.context??=new Set()).add('place');pi.events.emit('coc:location-demand',{campaign,turn:observedTurn,review:relevance.review,selection:relevance.selection});}
                if(relevance.needed&&call){
                    const bridge=call,owner=campaign;
                    if(locationIdentityRead?.key!==key)locationIdentityRead={key,promise:boundedDiscoveryRead(async()=>locationIdentityContext(object(await bridge('mods.locations.inspect',{campaign:owner,need:'context'}))))};
                    try{
                        const identity=await locationIdentityRead.promise;
                        if(ticket===generation&&!inputLifetime.signal.aborted&&snapshot.binding.campaign===campaign&&snapshot.binding.turn===observedTurn)locationIdentity=identity;
                    }catch(error){record({lane:'location-identity-preparation',turn:observedTurn,status:'unavailable',reason:String((error as Error)?.message??error).slice(0,160)});}
                }
                const routes=snapshot.capsule.where?.location?.observation_routes;
                if(relevance.status==='answered'&&relevance.needed&&relevance.review===false&&Array.isArray(routes)&&routes.length===1&&call){
                    const bridge=call,owner=campaign;
                    if(observationReferenceRead?.key!==key)observationReferenceRead={key,promise:boundedDiscoveryRead(async()=>{
                        const result=object(await bridge('mods.locations.inspect',{campaign:owner,...routes[0].read}));
                        const view=object(result.observation);
                        return Array.isArray(view.recent_observations)?{to:view.to,sense:view.sense,records:view.recent_observations.slice(0,4)}:undefined;
                    })};
                    try{
                        const prepared=await observationReferenceRead.promise;
                        if(prepared&&ticket===generation&&!inputLifetime.signal.aborted&&snapshot.binding.campaign===campaign&&snapshot.binding.turn===observedTurn){
                            observationReference=prepared;
                            pi.events.emit('coc:location-demand',{campaign,turn:observedTurn,references:{to:prepared.to,sense:prepared.sense,recent_observations:prepared.records}});
                            record({lane:'observation-reference-preparation',turn:observedTurn,scope:prepared.to,sense:prepared.sense,records:prepared.records.length,changed_world:false});
                        }
                    }catch(error){record({lane:'observation-reference-preparation',turn:observedTurn,status:'unavailable',reason:String((error as Error)?.message??error).slice(0,160)});}
                }
                record({lane:'location-context',...relevance,reused});
            }
        }
        // Pi 0.87 restores the canonical system/tool checkpoint after this hook. Reserve its
        // serialized size on every exit, including degraded turns, without treating it as history.
        const {systemBytes, systemDigest} = systemMeasure(ctx);
        const ceiling = requestBudget(ctx.model?.contextWindow), budget = Math.max(0, ceiling - systemBytes);
        if (!snapshot) return {messages: degradedRequest(requestMessages as unknown as Row[], ctx, lastReason) as typeof requestMessages};
        const messages = requestMessages as unknown as Row[];
        let seen = false;
        // §103.5: the capsule the Keeper is sent is this copy, not the persisted message; it carries the Keeper's untold view.
        const view = untoldView(structuredClone(snapshot.capsule)).capsule;
        if(decisionAuthor&&typeof view.head==='string')view.head=keeperCapsuleHead(view.head,true);
        if(locationIdentity)view.location_identity=locationIdentity;
        if(observationReference)view.observation_reference={...observationReference,
            authority:'Delivered historical records only. Repeated person refs identify the same recorded person. Reading neither refreshes perception nor moves people or advances time.'};
        // Current-request visibility is a procedural instruction, never canonical state or writer material.
        const reply=referenceReplyStatus?.();
        if(reply?.queued&&reply.campaign===snapshot.binding.campaign&&reply.turn===snapshot.binding.turn)
            view.head=String(view.head??'')+'\nThe direct OOC reply for this input is already queued for display. Do not repeat that answer while checking materials or retrying output. If new evidence requires correction, give only the correction in the direct channel. This queue status is not story material or a world fact.';
        // The immutable full briefing already has these fields; retain the turn-specific craft selection.
        delete view.module;
        if (view.mods) {view.mods = {...view.mods}; delete view.mods.instructions; delete view.mods.topics;}
        // Contract §135.23 (single-loop engine only): a turn's request is append-only. The brief is the source's own
        // (stable across turns, not the residue of this turn's capsule); the capsule and the run's packet stay as the
        // turn's first request sent them; what changed since rides at the end (`coc-capsule-update`, a later run packet),
        // so every model call of a turn, and the next turn's first call, can read the earlier prefix from cache.
        // §184.2: on this engine the capsule the Keeper is sent has its stable sections first (`stableFirst`); the update
        // compares section values against the kernel's own copy, so its sections and `removed` keep the kernel's order.
        const turnTail:Row[]=[];
        let capsuleSent=view,runPacket:Row|undefined;
        if(runOwnsPrescreen){
            const epoch=inputEpoch??snapshot.key;
            if(turnMaterial?.epoch!==epoch)turnMaterial={epoch,capsule:view,sent:stableFirst(view)};
            capsuleSent=turnMaterial.sent;
            const update=capsuleUpdate(turnMaterial.capsule,view);
            if(update)turnTail.push(customMessage(CAPSULE_UPDATE_TYPE,update));
            const current=runPrescreen&&runPrescreen.campaign===campaign&&runPrescreen.turn===snapshot.binding.turn?runPrescreen.message:undefined;
            if(current&&!turnMaterial.packet)turnMaterial.packet=current;
            runPacket=turnMaterial.packet;
            if(current&&runPacket&&String(current.content)!==String(runPacket.content))turnTail.push(current);
        }
        const briefSent=runOwnsPrescreen?snapshot.brief:briefForTurn(snapshot.brief,view);
        const room=Math.max(0,budget-(turnTail.length?requestSize(turnTail):0));
        const selected = messages.map(message => {
            const actual = bindingOf(object(message.details).context);
            const sameInput = inputEpoch && object(message.details).epoch === inputEpoch;
            if (message.role !== 'custom' || message.customType !== 'coc-capsule' || !sameInput && (!actual || epochOf(actual) !== snapshot.key)) return message;
            seen = true;
            return {...message, content: JSON.stringify(capsuleSent), details: {...object(message.details), context: snapshot.binding}};
        })
            // The workspace is transport-only: at most one current message, injected below for this
            // request. A persisted copy from anywhere is dropped here, not projected onward.
            .filter(message => !(message.role === 'custom' && [WORKSPACE_TYPE, PRESCREEN_TYPE, CAPSULE_UPDATE_TYPE].includes(message.customType)));
        // §176.8: the request's rename runs before the projection fits the budget, not after it. A renamed tool result
        // ends with the untold note, and a word is often longer than the name it replaces: renamed after the fit, a busy
        // turn went out 553 B over its ceiling (long-campaign-context). The rename on the way out stays; it changes nothing twice.
        selected.splice(0, selected.length, ...rename(selected));
        if (!seen && !messages.some(message => message.role === 'custom' && message.customType === 'coc-capsule')) {
            // A new opening/recovery may have only a host prompt; this ephemeral capsule is not persisted.
            selected.push({...customMessage('coc-capsule', capsuleSent), details: {coc_host: true, turn: snapshot.binding.turn, context: snapshot.binding}});
        }
        let workspace=snapshot.workspaceMode==='on'?snapshot.workspace:undefined,prescreen:Row|undefined;
        // §184.2: the single-loop engine's order puts the turn's capsule ahead of the history; the legacy engine's is unchanged.
        const project=(budget:number,optional:{workspace?:Row;prescreen?:Row}={})=>{
            const input={messages:selected,binding:snapshot.binding,history:snapshot.history,brief:briefSent,
                answering:snapshot.answering,budget,...optional,...(runOwnsPrescreen?{capsuleFirst:true}:{}),singleKeeper};
            const fitted=projectedMessages(input);
            if(!singleKeeper||!runOwnsPrescreen||retainsLatestToolBatch(selected,fitted.messages,snapshot.binding))return fitted;
            const updates=turnTail.filter(message=>message.customType===CAPSULE_UPDATE_TYPE);
            if(!updates.length)return fitted;
            // Cache-prefix stability yields before current native answers. The kernel already
            // supplied this materialized view; no model summary or canonical rewrite is needed.
            const reclaimed=requestSize(turnTail)-requestSize(turnTail.filter(message=>!updates.includes(message)));
            const current=selected.map(message=>{
                const actual=bindingOf(object(message.details).context);
                return message.role==='custom'&&message.customType==='coc-capsule'&&actual&&epochOf(actual)===snapshot.key
                    ?{...message,content:JSON.stringify(stableFirst(view))}:message;
            });
            const consolidated=projectedMessages({...input,messages:rename(current),budget:budget+reclaimed});
            record({lane:'context',event:'capsule_consolidation',budget:budget+reclaimed,
                bytes:requestSize(consolidated.messages),retained:retainsLatestToolBatch(current,consolidated.messages,snapshot.binding),
                before_bytes:requestSize(fitted.messages),update_bytes:reclaimed,protected_bytes:consolidated.protectedBytes});
            return retainsLatestToolBatch(current,consolidated.messages,snapshot.binding)
                ?{...consolidated,capsuleConsolidated:true}:fitted;
        };
        const projectedTail=(fitted:{capsuleConsolidated?:boolean})=>turnTail.filter(message=>!fitted.capsuleConsolidated||message.customType!==CAPSULE_UPDATE_TYPE);
        let messageBudget=room,baseline=project(room,{workspace});
        // §219.3: a projection a newer generation or a cancelled preparation overtook still goes to the provider as its
        // bounded baseline, so it still has its `context/request` row.
        const superseded=():ContextEventResult=>{
            const messages=rename(baseline.messages),bytes=requestSize(messages)+systemBytes;
            record({lane:'context',event:'request',at:new Date().toISOString(),version:POLICY_VERSION,turn:snapshot!.binding.turn,
                reason:'context_superseded',request_bytes:bytes,system_bytes:systemBytes,system_digest:systemDigest,
                local_token_estimate:Math.ceil(bytes/BYTES_PER_TOKEN),ceiling_bytes:ceiling,context_window:ctx.model?.contextWindow??null,
                ...(baseline.droppedTail?{dropped_tail:baseline.droppedTail}:{}),...requestSegments(messages)});
            return {messages:messages as typeof requestMessages};
        };
        // Compute the actual baseline only after system/tool/output reserves are known. Material
        // missing from this projection is not "already supplied" to the Keeper.
        try {
            const reserve=Math.min(16384,Math.floor((ctx.model?.contextWindow??65536)/4))*BYTES_PER_TOKEN;
            const totalLimit=Math.min(ceiling,(ctx.model?.contextWindow??Infinity)*BYTES_PER_TOKEN-reserve);
            messageBudget=Math.max(0,Math.min(room,totalLimit-systemBytes-(budget-room)));
            baseline=project(messageBudget,{workspace});
            if(!baseline.workspaceKept)workspace=undefined;
        } catch {
            workspace=undefined;
            baseline=project(messageBudget);
        }
        const supplementBudget=Math.max(0,messageBudget-requestSize(baseline.messages));
        const preparationSignal=optionalWork.signal,preparationCall=call,preparationCampaign=campaign;
        const materialEnabled=!runOwnsPrescreen&&prescreenEnabled()&&supplementBudget>=512;
        const port=decision();
        if((materialEnabled||discoveryMode()!=='full')&&port&&preparationCall&&preparationCampaign&&inputEpoch&&!prescreenDeadlineAt){
            beginPreparationAllowance();
        }

        if(runOwnsPrescreen){
            prescreen=runPacket;
        }else if(prescreenEnabled()&&supplementBudget>=512&&preparationCall&&preparationCampaign&&inputEpoch){
            if(!prescreenDeadlineAt){const allowance=readJevPreselectAllowanceMs(sessionEnv);prescreenDeadlineAt=Date.now()+allowance;
                record({lane:'prescreen',event:'allowance_started',allowance_ms:allowance});}
            const memoKey=fingerprint([generation,snapshot.key,baseline.messages,supplementBudget]);
            const query=String(object(snapshot.capsule.turn).player_text??'');
            try{prescreen=await reusePrescreen({call:preparationCall,campaign:preparationCampaign,binding:snapshot.binding,query,
                    message:prescreenMemo?.key===memoKey?prescreenMemo.message:reusablePrescreen,
                    suppliedMessages:baseline.messages,byteBudget:supplementBudget,signal:preparationSignal,
                    ...(sourceRuntime&&moduleId?{source:{moduleId,runtime:sourceRuntime}}:{})});}catch{prescreen=undefined;}
            const reused=prescreen,needsReassessment=object(object(reused?.details).prescreen).needs_reassessment===true;
            if(!prescreen||needsReassessment&&prescreenProviderBudget.actions>0&&Date.now()<prescreenDeadlineAt){
                let refreshOutcome='unknown';
                if(preparationSignal.aborted||ticket!==generation)return superseded();
                const refreshed=await preparePrescreen({call:preparationCall,campaign:preparationCampaign,binding:snapshot.binding,capsule:snapshot.capsule,
                    signal:preparationSignal,record:event=>{record(event);if(event.event==='prepared')refreshOutcome='prepared';
                        else if(event.event==='fallback')refreshOutcome='fallback';else if(event.event==='skipped')refreshOutcome=String(event.reason??'skipped');},
                    suppliedMessages:baseline.messages,byteBudget:supplementBudget,
                    deadlineAt:prescreenDeadlineAt,decision:sharedBudget?.decision,names:[...evidenceNames],rules:[...ruleNames],
                    providerBudget:prescreenProviderBudget,...(sourceRuntime&&moduleId?{source:{moduleId,runtime:sourceRuntime}}:{})});
                prescreen=refreshed??(needsReassessment&&['prepared','empty_catalog'].includes(refreshOutcome)?undefined:reused);
            }
            if(ticket!==generation||preparationSignal.aborted)return superseded();
            prescreenMemo={key:memoKey,message:prescreen};
            if(prescreen)reusablePrescreen=prescreen;
        }
        if(ticket!==generation||preparationSignal.aborted)return superseded();
        if(prescreen)prescreen=nameWritingSupport(prescreen,snapshot.binding);
        const initial=prescreen?project(messageBudget,{workspace,prescreen}):baseline;
        const window = ctx.model?.contextWindow, available = typeof window === 'number' ? window - Math.min(16384, Math.floor(window / 4)) : Infinity;
        const names=(materialSources?.(snapshot.binding.turn)??[]).slice(-6);
        let sourceHint:Row|undefined=names.length?{role:'custom',customType:'coc-material-source',display:false,timestamp:0,
            content:JSON.stringify({sources:names,authority:'Current-input reference names only; not disclosure or world authorization.'}),
            details:{coc_host:true,material_source:{campaign,turn:snapshot.binding.turn}}}:undefined;
        // Reference-name hints duplicate the original answers. They cannot displace those answers.
        if(sourceHint&&retainsLatestToolBatch(selected,initial.messages,snapshot.binding)
            &&requestSize([...initial.messages,...projectedTail(initial),sourceHint])+systemBytes>ceiling){
            record({lane:'context',event:'material_source_hint_omitted',reason:'preserve_latest_tool_batch',bytes:requestSize([sourceHint])});
            sourceHint=undefined;
        }
        const hintBytes=sourceHint?requestSize([sourceHint]):0;
        const fits=(list:Row[])=>requestSize(list)+hintBytes+systemBytes<=ceiling&&Math.ceil((requestSize(list)+hintBytes+systemBytes)/BYTES_PER_TOKEN)<=available;
        // The request around `reserve` bytes that the caller appends after it (contract §209.13: required package
        // detail), with the one diagnostic it is due. `omission` names package detail left out of this request.
        const assemble=(reserve:number,omission?:string)=>{
            reserve+=hintBytes;
            let fitted=reserve||omission?project(Math.max(0,messageBudget-reserve),{workspace,prescreen}):initial;
            const why=omission??fitted.degraded??(Math.ceil((requestSize(fitted.messages)+reserve+systemBytes)/BYTES_PER_TOKEN)>available?'request_window_estimate':undefined);
            let notice=why?diagnostic(why,...(omission?[PACKAGE_OMITTED_NOTE]:[])):undefined;
            // Reserve a diagnostic only when one is needed. An optional workspace must not be
            // displaced by a hypothetical notice on an otherwise healthy, within-budget request.
            if(notice){
                const beforeNotice=fitted;
                fitted=project(Math.max(0,messageBudget-reserve-requestSize([notice])),{workspace,prescreen});
                if(!omission&&retainsLatestToolBatch(selected,beforeNotice.messages,snapshot.binding)
                    &&!retainsLatestToolBatch(selected,fitted.messages,snapshot.binding)){
                    record({lane:'context',event:'diagnostic_omitted',reason:'preserve_latest_tool_batch',bytes:requestSize([notice])});
                    fitted=beforeNotice;notice=undefined;
                }
                if(!omission&&fitted.degraded==='latest_tool_batch_omitted'&&why!==fitted.degraded){
                    notice=diagnostic(fitted.degraded);
                    fitted=project(Math.max(0,messageBudget-reserve-requestSize([notice])),{workspace,prescreen});
                }
            }
            return {fitted,messages:rename([...(notice?[notice,...fitted.messages.filter(message=>!(message.role==='custom'&&message.customType===DIAGNOSTIC_TYPE))]:fitted.messages),...projectedTail(fitted)]
                .filter(message=>!(message.role==='custom'&&[EXPRESSION_MESSAGE,MOD_SECTIONS_MESSAGE,TEMPORAL_ADVICE_MESSAGE].includes(message.customType))))};
        };
        let {fitted:result,messages:outgoing}=assemble(0);
        // Contract §183.5: package sections this turn needs, at the end; nothing on a table whose instructions all go whole.
        pendingSections=undefined;
        pendingTemporal=undefined;
        const temporalWork=singleKeeper?Promise.resolve(undefined):temporalAdvice.message(snapshot.capsule,snapshot.binding,preparationSignal,requestMessages as unknown as Row[]);
        modSections.observe(snapshot.capsule,snapshot.binding,inputLifetime.signal);
        await modSections.waitForFirst(preparationSignal);
        if(ticket!==generation||preparationSignal.aborted)return superseded();
        const sectionsMessage=await modSections.message(snapshot.capsule,snapshot.binding,turnCalls);
        if(ticket!==generation||preparationSignal.aborted)return superseded();
        // Read only the current host-owned step, never a player's JSON or a past turn's plan.
        const stepMessage=[...requestMessages].reverse().find(message=>message.role==='custom'&&message.customType===CLERK_TYPE
            &&object(message.details).coc_host===true&&object(message.details).turn===snapshot.binding.turn);
        let discoveryTask:Row={};
        if(stepMessage)try{const step=object(JSON.parse(String(stepMessage.content)));
            if(step.kind==='single_loop_step')discoveryTask={purpose:step.purpose,reason:step.reason,check_preparation:step.check_preparation,
                operations:step.complete?[step.complete]:object(step.left_to_you).operation?[object(step.left_to_you).operation]:[]};
        }catch{/* Malformed host material supplies no selection facts. */}
        const handoff=discoveryHandoff;
        if(handoff?.campaign===snapshot.binding.campaign&&handoff.turn===snapshot.binding.turn
            &&(handoff.worldline??'main')===(snapshot.binding.worldline??'main')&&(handoff.loop??0)===(snapshot.binding.loop??0)
            &&handoff.source_revision===(snapshot.binding.task_source_revision??snapshot.binding.source_revision))
            discoveryTask=object(handoff.task);
        const discoveryCalls={apply:new Set(turnCalls.apply),resolve:new Set(turnCalls.resolve),context:new Set(turnCalls.context??[])};
        for(const op of discoveryTask.operations??[]){
            if(op.verb==='apply'&&typeof op.family==='string')discoveryCalls.apply.add(op.family);
            if(op.verb==='resolve'&&typeof op.family==='string')discoveryCalls.resolve.add(op.family);
        }
        capabilityRuntime.observe(snapshot.capsule,snapshot.binding,inputLifetime.signal,discoveryTask);
        modDiscovery.observe(snapshot.capsule,snapshot.binding,inputLifetime.signal,discoveryCalls,discoveryTask);
        await capabilityRuntime.wait();
        // §228.2: this input's disclosure. Every request re-places what earlier requests of the input carried, at the
        // places they had, and adds once what is newly due: package sections the selection or a write needs, and apply
        // detail. Nothing already sent is sent again, and nothing is moved to the end of the request.
        disclosure.forInput(String(inputEpoch??snapshot.key));
        let discoveryMessage:Row|undefined,omission:{reason:string;bytes?:number}|undefined,reserved=false;
        try{discoveryMessage=await modDiscovery.message(snapshot.capsule,snapshot.binding,preparationSignal,discoveryCalls,discoveryTask);}
        catch(error){
            // §209.13: the packet's own bound and an unreadable immutable section are explicit omissions; any other
            // failure is the hook's bounded degraded request.
            const code=error instanceof Error?error.message:String(error);
            if(!PACKAGE_OMISSIONS.has(code))throw error;
            omission={reason:code};
        }
        const anchor=disclosure.count(outgoing.slice(0,outgoing.length-projectedTail(result).length));
        const owed=disclosure.owed();
        const selectedRows=sectionRows(discoveryMessage);
        const owedKeys=owed.filter(key=>key.startsWith('section:')).map(key=>key.slice('section:'.length))
            .filter(key=>!selectedRows.some(row=>row.key===key));
        let owedRows:Row[]=[];
        if(owedKeys.length)try{owedRows=await modDiscovery.sections(owedKeys);}
        catch(error){record({lane:'turn-disclosure',event:'owed_unavailable',turn:snapshot.binding.turn,keys:owedKeys,reason:String((error as Error)?.message??error).slice(0,160)});}
        if(ticket!==generation||preparationSignal.aborted)return superseded();
        const rows=[...selectedRows,...owedRows],fresh:Row[]=[];
        const sectionPacket=disclosure.offer(rows.map(row=>sectionKey(row.key)),anchor,keys=>{
            const sent=rows.filter(row=>keys.includes(sectionKey(row.key)));
            return{role:'custom',customType:'coc-mod-sections',display:false,timestamp:0,
                content:JSON.stringify({authority:SECTIONS_AUTHORITY,sections:sent.map(row=>({package:row.package,section:row.section,text:row.text}))}),
                details:{coc_host:true,mod_sections:{turn:snapshot.binding.turn,keys:sent.map(row=>row.key),policy:'discovery-v2',
                    status:object(object(discoveryMessage?.details).mod_sections).status??'owed'}}};
        });
        if(sectionPacket)fresh.push(sectionPacket);
        // Sections the input delivered name the core capabilities they depend on; their apply detail is due with them.
        const required=(Array.isArray(object(snapshot.capsule.mods).instructions)?object(snapshot.capsule.mods).instructions:[])
            .flatMap((mod:Row)=>(mod.sections??[]).filter((section:Row)=>disclosure.has(sectionKey(section.key))).flatMap((section:Row)=>section.dependencies??[]));
        const dueNames=[...capabilityRuntime.due(required),...owed.filter(key=>key.startsWith('capability:')).map(key=>key.slice('capability:'.length))];
        const detailPacket=disclosure.offer(dueNames.map(capabilityKey),anchor,keys=>{
            const detail=capabilityDetail(offeredTools(COC_TOOLS,sessionEnv),keys.map(key=>key.slice('capability:'.length)));
            if(!detail.length)return;
            return{role:'custom',customType:CAPABILITY_DETAIL_TYPE,display:false,timestamp:0,
                content:JSON.stringify({authority:CAPABILITY_AUTHORITY,capabilities:detail}),
                details:{coc_host:true,capability_detail:{turn:snapshot.binding.turn,names:detail.map(card=>card.name)}}};
        });
        if(detailPacket)fresh.push(detailPacket);
        // §209.13: required package detail outranks history and this turn's older tool traffic. Everything this input
        // disclosed stays in its requests, so the room is reserved for all of it. When it does not fit, what is new this
        // request is withdrawn (it stays due) and said so; when even the earlier disclosure cannot fit, none is placed.
        let packets=disclosure.messages();
        if(packets.length&&!fits([...outgoing,...packets])){
            let widened=assemble(requestSize(packets));
            if(!fits([...widened.messages,...packets])){
                omission={reason:'mod_discovery_request_capacity',bytes:requestSize(fresh)};
                for(const message of fresh)disclosure.withdraw(message);
                fresh.length=0;packets=disclosure.messages();
                widened=assemble(requestSize(packets));
                if(!fits([...widened.messages,...packets])){omission.bytes=requestSize(packets);packets=[];}
            }
            result=widened.fitted;outgoing=widened.messages;reserved=packets.length>0;
        }
        if(omission){
            ({fitted:result,messages:outgoing}=assemble(requestSize(packets),omission.reason));
            record({lane:'mod-discovery',event:'omitted',turn:snapshot.binding.turn,reason:omission.reason,...(omission.bytes?{bytes:omission.bytes}:{})});
        }
        if(packets.length)outgoing=disclosure.place(outgoing,outgoing.length-projectedTail(result).length);
        pendingDiscovery=fresh;
        // §183.5's sections are optional beside the disclosure: they join only when they still fit.
        if(sectionsMessage&&fits([...outgoing,sectionsMessage])){
            outgoing.push(sectionsMessage);pendingSections=sectionsMessage;
        }else if(sectionsMessage)record({lane:'mod-sections',event:'omitted',turn:snapshot.binding.turn,reason:'request_ceiling',bytes:requestSize([sectionsMessage])});
        const temporalMessage=await temporalWork;
        if(ticket!==generation||preparationSignal.aborted)return superseded();
        if(temporalMessage&&fits([...outgoing,temporalMessage])){
            outgoing.push(temporalMessage);pendingTemporal=temporalMessage;
        }else if(temporalMessage)record({lane:'temporal-context',event:'omitted',turn:snapshot.binding.turn,reason:'request_ceiling',bytes:requestSize([temporalMessage])});

        const expressionView={...snapshot.capsule,expression_exchange:snapshot.history};
        expressionHistory={campaign:snapshot.binding.campaign,turn:snapshot.binding.turn,history:snapshot.history};
        expression.observe(expressionView,snapshot.binding,inputLifetime.signal);
        if(ticket!==generation||preparationSignal.aborted)return superseded();
        // §233.19: pure expression examples belong to the selected author. The first Keeper request never waits for them.
        if(discoveryMode()!=='full'){
            const began=Date.now();
            try{
                if(!preparationCall)throw Error('discovery_snapshot_unavailable');
                const fresh=object(await boundedDiscoveryRead(()=>preparationCall('table.capsule',{campaign:preparationCampaign}))),
                    current=bindingOf(fresh._context),expected=snapshot.binding;
                if(ticket!==generation||preparationSignal.aborted)throw Error('discovery_snapshot_cancelled');
                if(!current||current.unavailable||current.campaign!==expected.campaign||current.worldline!==expected.worldline
                    ||current.loop!==expected.loop||current.turn!==expected.turn
                    ||(current.task_source_revision??current.source_revision)!==(expected.task_source_revision??expected.source_revision)
                    ||current.task_world_revision!==expected.task_world_revision)throw Error('discovery_snapshot_changed');
                record({lane:'context',event:'discovery_snapshot',status:'current',ms:Date.now()-began,read_bytes:sizeOf(fresh),
                    read_owner:discoveryReadOwner().owner});
                discoveryUnavailable=false;verifiedInputEpoch=inputEpoch;
            }catch(error){
                const reason=String(error?.message??'discovery_snapshot_unavailable').slice(0,160);
                record({lane:'context',event:'discovery_snapshot',turn:snapshot.binding.turn,status:'unavailable',reason,ms:Date.now()-began});
                if(ticket===generation){
                    discoveryUnavailable=true;
                    capabilityRuntime.invalidate();modDiscovery.reset();pendingDiscovery=[];
                    pendingSections=undefined;pendingTemporal=undefined;pendingProvider=undefined;
                    capsule=undefined;rawBinding=undefined;brief=undefined;briefKey=undefined;invalidate();degraded(reason);
                }
                // §219.3: the same bounded degraded request as every other failure, with its `context/request` row.
                return{messages:degradedRequest(requestMessages as unknown as Row[],ctx,reason) as typeof requestMessages};
            }
        }
        if(sourceHint) {
            if(requestSize([...outgoing,sourceHint])+systemBytes<=ceiling
                &&Math.ceil((requestSize([...outgoing,sourceHint])+systemBytes)/BYTES_PER_TOKEN)<=available)outgoing.push(sourceHint);
        }
        if(materialScreen)outgoing=materialScreen.project(outgoing);
        const locationHistory=projectLocationInspections(outgoing,snapshot.binding.turn);outgoing=locationHistory.messages;
        if(locationHistory.omittedBytes)record({lane:'context',event:'location_detail_omitted',turn:snapshot.binding.turn,bytes:locationHistory.omittedBytes});
        if(singleKeeper&&policyFor(ctx.model)&&!result.degraded&&!result.overCeiling&&!omission){
            const journal=requestJournal.project({messages:outgoing,turn:snapshot.binding.turn,
                key:JSON.stringify([snapshot.binding.campaign,snapshot.binding.worldline,snapshot.binding.loop,moduleId,
                    ctx.model?.provider,ctx.model?.id,systemDigest]),
                budget:Math.max(0,Math.min(ceiling,available*BYTES_PER_TOKEN)-systemBytes)});
            outgoing=journal.messages;
            record({lane:'context',event:'request_journal',...journal.observation});
        }else requestJournal.reset();
        const bytes = requestSize(outgoing) + systemBytes, estimatedTokens = Math.ceil(bytes / BYTES_PER_TOKEN);
        const requestId=`prescreen:${snapshot.binding.turn}:${++providerSequence}`;
        pendingProvider=prescreen?{requestId,prepared:rename([prescreen])[0],outgoingDigest:fingerprint(outgoing)}:undefined;
        record({lane: 'context', event: 'request', at: new Date().toISOString(), version: POLICY_VERSION, turn: snapshot.binding.turn,request_id:requestId,
            history_bytes: sizeOf(snapshot.history), protected_bytes: result.protectedBytes, unknown_bytes: result.unknownBytes,
            ...(pendingSections?{mod_sections_bytes:requestSize([pendingSections])}:{}),
            ...(packets.length?{disclosure_bytes:requestSize(packets),
                mod_discovery_bytes:requestSize(packets.filter(message=>message.customType==='coc-mod-sections')),
                capability_detail_bytes:requestSize(packets.filter(message=>message.customType===CAPABILITY_DETAIL_TYPE))}:{}),
            ...(fresh.length?{disclosure_new_bytes:requestSize(fresh)}:{}),
            ...(reserved?{mod_discovery_reserved:true}:{}),
            ...(omission?.bytes?{mod_discovery_omitted_bytes:omission.bytes}:{}),
            request_bytes: bytes, system_bytes: systemBytes, system_digest: systemDigest, local_token_estimate: estimatedTokens, context_window: window ?? null, ceiling_bytes: ceiling,
            ...(result.prescreenKept && prescreen ? {prescreen_bytes: requestSize([prescreen]), prescreen_injected: true} : {}),
            ...(projectedTail(result).length ? {tail_bytes: requestSize(projectedTail(result)), tail: projectedTail(result).map(message => message.customType)} : {}),
            ...(result.workspaceKept && workspace ? {workspace_bytes: requestSize([workspace])} : {}),
            ...(result.workspaceKept && workspace ? {workspace_evidence_injected: JSON.parse(String(workspace.content)).evidence.length} : {}),
            ...(result.droppedTail ? {dropped_tail: result.droppedTail} : {}),
            ...(result.droppedUnknown ? {dropped_unknown: result.droppedUnknown} : {}),
            ...(result.degraded ? {reason: result.degraded} : {}),
            ...(omission ? {capacity: omission.reason} : result.overCeiling ? {capacity: 'request_ceiling_exceeded'}
                : estimatedTokens > available ? {capacity: 'request_window_estimate'} : {}),
            ...requestSegments(outgoing)});
        return {messages: outgoing as typeof requestMessages};
    }
    pi.on('context_with_system',event=>{
        const tools=getCurrentTools(event.messages as never);
        const selectedView=capabilityRuntime.project(tools as any);
        const view=locationToolDeclarations((selectedView??tools) as any,locationDetail());
        const current=getCurrentSystemMessage(event.messages as never) as Row|undefined;
        if(!current)return;
        const {toolsAdded:_added,toolsRemoved:_removed,...head}=current;
        const messages=view?[{...head,toolsAdded:view},...event.messages.filter(message=>message.role!=='system')]:event.messages;
        const finalHead=getCurrentSystemMessage(messages as never) as Row;
        const {toolsAdded:_tools,toolsRemoved:_removedAgain,...prose}=finalHead;
        const schemas=view??tools;
        record({lane:'context',event:'request_projection',
            mode:selectedView?'selected':'full_with_location_entry',projected_request_bytes:sizeOf(messages),
            projected_system_bytes:sizeOf(finalHead),system_prose_bytes:sizeOf(prose),
            tool_schema_bytes:sizeOf(schemas),canonical_tool_schema_bytes:sizeOf(tools),
            projected_request_digest:fingerprint(messages),
            mod_discovery_bytes:requestSize(messages.filter(message=>message.role==='custom'&&message.customType==='coc-mod-sections')),
            measurement:'public_context_json_bytes_not_provider_tokens'});
        if(view)return{messages:messages as never};
    });
    // Public Pi seam after provider conversion. Observe only whether the exact prepared packet
    // survived serialization; never record headers, secrets or the private payload.
    pi.on('before_provider_request', event => {
        const payload=(event as unknown as Row).payload;
        requestJournal.commit();
        const declared=Array.isArray(payload?.tools)?payload.tools:Array.isArray(payload?.functions)?payload.functions:[];
        const declaredTool=(name:string)=>declared.find((tool:Row)=>(tool.function?.name??tool.name)===name);
        if(payload&&typeof payload==='object')record({lane:'context',event:'provider_projection',
            provider_projection_bytes:sizeOf(payload),provider_projection_digest:fingerprint(payload),
            tool_declaration_bytes:sizeOf(declared),place_entry_bytes:declaredTool('place')?sizeOf(declaredTool('place')):0,
            apply_entry_bytes:declaredTool('apply')?sizeOf(declaredTool('apply')):0,output_entry_bytes:declaredTool('output')?sizeOf(declaredTool('output')):0,
            measurement:'provider_adapter_json_bytes_before_later_hooks_not_wire_bytes_or_tokens'});
        // §228.2: a new disclosure counts as delivered only when the provider payload carries it; one that did not
        // survive is withdrawn and offered again on the next request.
        const discovered=pendingDiscovery;pendingDiscovery=[];
        for(const message of discovered){
            const sent=payloadContains((event as unknown as Row).payload,String(message.content));
            if(!sent)disclosure.withdraw(message);
            record({lane:message.customType==='coc-mod-sections'?'mod-discovery':'turn-disclosure',event:'delivered',
                turn:object(object(message.details).mod_sections??object(message.details).capability_detail).turn,
                delivered:sent,bytes:Buffer.byteLength(String(message.content))});
        }
        const temporalSent=pendingTemporal;pendingTemporal=undefined;
        if(temporalSent)temporalAdvice.delivered(temporalSent,(event as unknown as Row).payload,payloadContains);
        if(temporalSent&&campaign&&payloadContains((event as unknown as Row).payload,String(temporalSent.content)))
            pi.events.emit?.('coc:writing-guidance',{campaign,turn:temporalSent.details.temporal_advice.turn,kind:'temporal',content:JSON.parse(String(temporalSent.content))});
        const sectionsSent=pendingSections;pendingSections=undefined;
        if(sectionsSent)modSections.delivered(sectionsSent,(event as unknown as Row).payload,payloadContains);
        if(sectionsSent&&campaign&&payloadContains((event as unknown as Row).payload,String(sectionsSent.content))) {
            const supplied=object(JSON.parse(String(sectionsSent.content)));
            pi.events.emit?.('coc:writing-guidance',{campaign,turn:sectionsSent.details.mod_sections.turn,kind:'sections',
                revision:fingerprint(object(capsule).mods?.instructions??[]),content:{authority:supplied.authority,
                    sections:(supplied.sections??[]).filter((section:Row)=>['narration-craft','zh-optimize','npc-voice'].includes(section.package))}});
        }
        const pending=pendingProvider;pendingProvider=undefined;if(!pending)return undefined;
        if(!pending.prepared)return undefined;
        const prepared=object(pending.prepared),meta=object(object(prepared.details).prescreen);
        if(!prepared.content){record({lane:'prescreen',event:'delivered',request_id:pending.requestId,delivered:false,reason:'not_prepared'});return undefined;}
        let retained=false;
        try{retained=payloadContains((event as unknown as Row).payload,String(prepared.content));}catch{/* Unserializable payload is unconfirmed. */}
        let content:Row={};try{content=object(JSON.parse(String(prepared.content)));}catch{/* malformed prepared content is unconfirmed */}
        const materials=Array.isArray(content.materials)?content.materials:[],keys=Array.isArray(meta.material_keys)?meta.material_keys:[];
        if(retained&&object(prepared.details).writing_support)pi.events.emit('coc:writing-support',{
            binding:object(prepared.details).writing_support.binding,materials});
        const retainedMaterials=retained?materials.map((material:Row,index:number)=>({key:keys[index]??`material:${index}`,
            digest:fingerprint(material.content??null),bytes:sizeOf(material.content??null),coverage:structuredClone(object(material.coverage))})):[];
        const omitted=retained?[]:keys.map((key:string)=>({key,reason:'provider_payload_mismatch'}));
        record({lane:'prescreen',event:'delivered',request_id:pending.requestId,prepared_digest:meta.prepared_digest??null,
            outgoing_digest:pending.outgoingDigest,delivered:retained,retained:retainedMaterials,omitted,
            coverage:structuredClone(object(content.coverage)),...(retained?{bytes:requestSize([prepared])}:{reason:'provider_payload_mismatch'})});
        return undefined;
    });

    pi.on('session_before_compact', async event => {
        const snapshot = await prepare();
        const entries = (event.branchEntries as unknown as Row[]).map(entry => inputEpoch && entry.type === 'custom_message'
            && entry.customType === 'coc-capsule' && object(entry.details).epoch === inputEpoch && snapshot
            ? {...entry, details: {...object(entry.details), context: snapshot.binding}} : entry);
        const plan = snapshot && foldPlan(entries, snapshot.binding, snapshot.history, snapshot.answering);
        if (!snapshot || !plan) {
            record({lane: 'fold', ok: false, reason: 'no_safe_cut', trigger: event.reason, ...(event.reason === 'overflow' ? {capacity: 'protected_context'} : {})});
            return {cancel: true};
        }
        const key = fingerprint([plan.firstKeptEntryId, plan.summary]);
        const previous = [...event.branchEntries].reverse().find(entry => entry.type === 'compaction') as Row | undefined;
        if (key === lastFold || previous?.details?.coc_fold?.plan_key === key) {
            record({lane: 'fold', ok: false, reason: 'no_progress', trigger: event.reason});
            return {cancel: true};
        }
        plan.details.coc_fold.plan_key = key;
        record({lane: 'fold', ok: true, version: POLICY_VERSION, trigger: event.reason,
            folded_entries: plan.folded, history_bytes: sizeOf(snapshot.history), tokens_before: event.preparation.tokensBefore});
        return {compaction: {summary: plan.summary, firstKeptEntryId: plan.firstKeptEntryId,
            tokensBefore: event.preparation.tokensBefore, details: plan.details}};
    });
    pi.on('session_compact', async event => {
        const entry = object((event as unknown as Row).compactionEntry);
        lastFold = object(object(entry.details).coc_fold).plan_key;
        invalidate();
        pi.sendMessage({customType: 'coc-host', display: false,
            content: 'Older dialogue is available through bounded recall. The current capsule and briefing own the present state; a recording is not module truth.',
            details: {coc_host: true, kind: 'compacted'}}, {triggerTurn: false});
    });
    pi.on('before_agent_start', async (_event, ctx: ExtensionContext) => {
        const snapshot = await prepare(), usage = ctx.getContextUsage();
        if (!snapshot) return;
        const branch = ctx.sessionManager.getBranch() as unknown as Row[];
        const previous = [...branch].reverse().find(entry => entry.type === 'compaction');
        const boundary = previous ? branch.findIndex(entry => entry.id === previous.firstKeptEntryId) : 0;
        const retained = branch.slice(Math.max(0, boundary)).flatMap(entry => {
            const message = entryMessage(entry);
            return message && message.role !== 'system' ? [message] : [];
        });
        const retainedBytes = sizeOf(retained) + (previous ? Buffer.byteLength(String(previous.summary), 'utf8') : 0);
        // Raw retained bytes are diagnostic only. Current capsules, audit context and tool results
        // can be large while the actual model window is mostly empty, and a fold cannot discard
        // that protected current material. Only measured token-window pressure may pre-empt a turn.
        const rawPressure = retainedBytes > HISTORY_BYTES * 4;
        const tokenPressure = typeof usage?.percent === 'number' && usage.percent >= compactAt() * 100;
        if (!tokenPressure) {
            if (rawPressure) record({lane: 'fold', event: 'raw-pressure-observed', retained_bytes: retainedBytes,
                raw_pressure: true, percent: usage?.percent ?? null, token_pressure: false});
            return;
        }
        record({lane: 'fold', event: 'pressure', retained_bytes: retainedBytes, raw_pressure: rawPressure,
            percent: usage?.percent ?? null, token_pressure: tokenPressure});
        const attempt = snapshot.key;
        if (lastAttempt === attempt) return;
        lastAttempt = attempt;
        await new Promise<void>(done => {
            try {
                ctx.compact({onComplete: () => {record({lane: 'fold', event: 'pre-emptive', ok: true, percent: usage?.percent ?? null}); done();},
                    onError: error => {record({lane: 'fold', event: 'pre-emptive', ok: false, reason: 'compact_unavailable', detail: error.message.slice(0, 160)}); done();}});
            } catch {record({lane: 'fold', event: 'pre-emptive', ok: false, reason: 'compact_unavailable'}); done();}
        });
    });
}
