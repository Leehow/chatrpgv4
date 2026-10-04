import {createDecisionAdapter} from '../../runtime/jev/decision-adapter.ts';
import {readJevApiKey,readJevPreselectAllowanceMs} from '../jev/agent/config.js';
import {preparationBudget,preparationProviderBudget} from '../../runtime/jev/preparation-budget.ts';
import type {DecisionPort} from '../../runtime/jev/decision-port.ts';
import type {TaskProviderBudget} from '../../runtime/jev/provider-budget.ts';
/** Request and persistence adapters for the one bounded play-context policy. */
import {createHash} from 'node:crypto';
import {dirname, join} from 'node:path';
import type {ExtensionAPI, ExtensionContext} from '@earendil-works/pi-coding-agent';
import {getCurrentSystemMessage} from '@earendil-works/pi-ai';
import {compactAt} from './fold.ts';
import {renameUntold, untoldPeople, untoldView, type UntoldPerson} from '../kernel/untold-view.ts';
import {createWorkpadStore, type WorkpadView} from './workspace/workpad-store.ts';
import {selectWorkspace, workspaceBudgetOf, workspaceModeOf, workspaceSettingsOf, workspaceCandidates, type WorkspaceMode} from './workspace/projection.ts';
import {reuseEvidence, dormantEvidence} from './workspace/evidence.ts';
import {rankWorkspaceCandidates} from './workspace/reranker.ts';
import {preparePrescreen,prescreenEnabled,reusePrescreen} from './prescreen.ts';
import type {PrescreenSourceRuntime} from '../../runtime/jev/prescreen-source-provider.ts';
import {createExpressionPreparation,EXPRESSION_MESSAGE,removeExpressionPayload} from './expression-reference.ts';
import {createModSections,emptyCalls,noteCall,MOD_SECTIONS_MESSAGE} from './mod-sections.ts';
import {bindingOf, customMessage, epochOf, sourceOf, historyView, metadata, quoteView, briefForTurn, projectedMessages, foldPlan,
    boundedTail, requestBudget, BYTES_PER_TOKEN, HISTORY_BYTES, POLICY_VERSION, DIAGNOSTIC_TYPE, WORKSPACE_TYPE, PRESCREEN_TYPE, entryMessage, object, sizeOf, requestSize,
    capsuleUpdate, stableFirst, CAPSULE_UPDATE_TYPE, NPC_ADVICE_TYPE,
    type ContextBinding, type Quote, type Row} from './context-policy.ts';

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
const briefingKey = (binding: ContextBinding, capsule: Row): string => {
    const instructions = object(capsule.mods).instructions;
    // Frozen package versions bind their bytes, and a package's form (§183.3: full or indexed) follows from the set and
    // its order; never reuse an old effective provider or its settings after activation.
    const providers = Array.isArray(instructions) ? instructions.map(value => {
        const row = object(value);
        return {mod: row.mod, version: row.version, settings: row.settings, form: row.form};
    }) : [];
    return fingerprint([sourceOf(binding), providers]);
};
function payloadContains(value:unknown,content:string,seen=new Set<object>()):boolean {
    if(typeof value==='string')return value===content||value.includes(content);
    if(!value||typeof value!=='object'||seen.has(value as object))return false;seen.add(value as object);
    return (Array.isArray(value)?value:Object.values(value as Row)).some(child=>payloadContains(child,content,seen));
}

export function installContextPolicy(pi: ExtensionAPI, writeTelemetry: (row: Row) => void,
    workpadRoot?: () => string | undefined): void {
    let observedTurn: number | undefined;
    const record = (row: Row): void => writeTelemetry({...(observedTurn === undefined ? {} : {turn: observedTurn}), ...row});
    let failedGeneration: number | undefined, inputPending = false;
    let call: KernelCall | undefined, campaign: string | undefined, capsule: Row | undefined, rawBinding: unknown;
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
    let runOwnsPrescreen=false,runPrescreen:{campaign:string;turn:number;message:Row}|undefined;
    // Contract §135.23: the turn's first capsule and first run packet, as the first request of the input sent them.
    // §184.2: `sent` is that capsule as the Keeper is sent it (stable sections first); `capsule` keeps the kernel's own copy.
    let turnMaterial:{epoch:string;capsule:Row;sent:Row;packet?:Row}|undefined;
    pi.events.on('coc:loop-engine',value=>{runOwnsPrescreen=object(value).prescreen==='run';});
    pi.events.on('coc:run-prescreen',value=>{const packet=object(value);
        runPrescreen=typeof packet.campaign==='string'&&Number.isSafeInteger(packet.turn)&&packet.message?{campaign:packet.campaign,turn:packet.turn,message:object(packet.message)}:undefined;});
    let sessionEnv={...process.env},sharedAdapter:DecisionPort|undefined,sharedBudget:ReturnType<typeof preparationBudget>|undefined;
    let inputLifetime=new AbortController(),foregroundBudget:(()=>TaskProviderBudget|undefined)|undefined;
    const decision=()=>{
        if(!readJevApiKey(sessionEnv))return undefined;
        const capacity=Number(sessionEnv.PI_COC_JEV_CONCURRENCY??16);
        return sharedAdapter??=createDecisionAdapter({env:sessionEnv,maxConcurrency:Number.isInteger(capacity)&&capacity>0?Math.min(capacity,16):16});
    };
    const expression=createExpressionPreparation({read:async(method,params)=>call?call(method,params):undefined,decision,record});
    let pendingExpression:Row|undefined;
    // Contract §183.5: the indexed packages' sections this turn needs; the calls so far this turn are what triggers read.
    const modSections=createModSections({read:async(method,params)=>call?call(method,params):undefined,decision,record});
    let turnCalls=emptyCalls(),pendingSections:Row|undefined;
    const resetPreparation=()=>{inputLifetime.abort();inputLifetime=new AbortController();sharedBudget?.close();sharedBudget=undefined;};
    pi.events.on('coc:task-provider-budget',value=>{foregroundBudget=typeof value==='function'?value as typeof foregroundBudget:undefined;});
    // Contract §168.5: a capsule this hook reads itself is handed over through the kernel extension's first-sight view, as
    // the player-input capsule already was: an item whose check is still running is left out, and what is carried is noted.
    let firstSight:{campaign:string;view:(capsule:Row)=>Row}|undefined;
    // Contract §103.5: who is still untold, campaign-wide (`table.untold`), read with each snapshot; the last one read
    // renames every request, the degraded one included.
    let untoldRoster:UntoldPerson[]=[];
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
        lastReason = reason;
        const key = `${generation}:${reason}`;
        if (key !== lastDegraded) {lastDegraded = key; record({lane: 'context', event: 'degraded', reason});}
    };
    pi.on('input', async () => {inputPending=true;turnCalls=emptyCalls();invalidate();});
    pi.events.on('coc:kernel-bridge', data => {
        const value = object(data), nextCall = typeof value.call === 'function' ? value.call : undefined;
        const nextCampaign = typeof value.campaign === 'string' ? value.campaign : undefined;
        const changed = call !== nextCall || campaign !== nextCampaign;
        call = nextCall; campaign = nextCampaign;
        const runtime=object(value.runtime);
        sourceRuntime=typeof runtime.home==='string'&&typeof runtime.sourceInfo==='function'&&typeof runtime.sourceText==='function'
            ?runtime as unknown as PrescreenSourceRuntime:undefined;
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
        inputPending = false;
        capsule = value.capsule ? structuredClone(value.capsule) : undefined;
        observedWorkspaceMode = workspaceModeOf(capsule);
        if (Number.isSafeInteger(object(capsule?.turn).number)) observedTurn = object(capsule?.turn).number;
        rawBinding = value.context;
        inputEpoch = nextEpoch;
        if(previousEpoch!==nextEpoch){resetPreparation();prescreenDeadlineAt=0;prescreenProviderBudget=preparationProviderBudget();
            prescreenMemo=undefined;reusablePrescreen=undefined;}
        answering = Array.isArray(value.answering) ? value.answering.filter((entry: unknown) => typeof entry === 'string') : undefined;
        sourceCalls.clear(); invalidate();
        if(capsule&&call&&campaign)expression.observe(capsule,{...object(rawBinding),campaign,turn:observedTurn??0},inputLifetime.signal);
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
        if (observedWorkspaceMode === 'off' && !prescreenEnabled() && !object(object(capsule?.mods).expression_reference).enabled || object(data).campaign && object(data).campaign !== campaign) return;
        capsule = undefined; rawBinding = undefined; brief = undefined; briefKey = undefined; prescreenMemo=undefined;reusablePrescreen=undefined; invalidate();
    });
    pi.on('tool_call', async event => {
        const input = object(event.input);
        if (event.toolName === 'look' || event.toolName === 'lookup')
            reads.set(event.toolCallId, {kind: String(input.kind ?? input.focus ?? ''),
                name: typeof input.name === 'string' ? input.name : undefined,
                query: typeof input.query === 'string' ? input.query : undefined});
        if (['apply', 'resolve', 'narrate', 'ask'].includes(event.toolName)) stateCalls.add(event.toolCallId);
        noteCall(turnCalls, event.toolName, input);
        if (event.toolName === 'lookup' && input.kind === 'source'
            || event.toolName === 'apply' && Array.isArray(input.effects) && input.effects.some((effect: Row) => effect.kind === 'adaptation'))
            sourceCalls.add(event.toolCallId);
    });
    pi.on('tool_result', async event => {
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
        const deliveredTurn=stateChanged&&(['narrate','ask'].includes(event.toolName)||object(event.details).narrate_in_apply===true);
        if(deliveredTurn){inputLifetime.abort();expression.reset();}
        // A failed transport can hide a committed mutation. Re-read the actual kernel state;
        // never infer arrival or settlement from the requested effect or an error flag.
        const expressionRefresh=stateChanged&&!deliveredTurn&&!!readJevApiKey(sessionEnv)&&object(object(capsule?.mods).expression_reference).enabled;
        if (!sourceChanged && !captured && !(stateChanged && (observedWorkspaceMode !== 'off' || prescreenEnabled() || expressionRefresh))) return;
        capsule = undefined; rawBinding = undefined; brief = undefined; briefKey = undefined; invalidate();
    });
    pi.on('session_start', async () => {expression.clear();pendingExpression=undefined;modSections.clear();pendingSections=undefined;turnCalls=emptyCalls();resetPreparation();untoldRoster=[];turnMaterial=undefined;sessionEnv={...process.env};sharedAdapter=undefined;invalidate(); observedWorkspaceMode = 'off'; inputPending = false; brief = undefined; briefKey = undefined; lastFold = undefined;
        lastAttempt = undefined; sourceCalls.clear(); stateCalls.clear();prescreenDeadlineAt=0;prescreenMemo=undefined;reusablePrescreen=undefined;
        prescreenProviderBudget=preparationProviderBudget();});
    pi.on('session_shutdown', async () => {expression.clear();pendingExpression=undefined;modSections.clear();pendingSections=undefined;turnCalls=emptyCalls();resetPreparation();untoldRoster=[];sharedAdapter=undefined;call=undefined;capsule=undefined;rawBinding=undefined;sourceRuntime=undefined;moduleId=undefined;observedWorkspaceMode='off';
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
            let rehydrated = false, reads = 0, readBytes = 0;
            const rpc = async (method: string, params: Row): Promise<Row> => object(await bridge(method, {campaign: owner, ...params}));
            try {
                if (!binding || !current) {
                    const result = await rpc('table.capsule', {rehydrate: true});
                    if (ticket !== generation || signal.aborted) return undefined;
                    const {_context, ...read} = result, view = firstSightView(owner, read);
                    binding = bindingOf(_context); current = view;
                    if (!binding) return fail('context_binding_unavailable');
                    rawBinding = _context; capsule = view; rehydrated = true;
                    expression.observe(view,{...object(_context),campaign:owner,turn:observedTurn??0},inputLifetime.signal);
                }
                // §103.5: read with the snapshot, so a turn's every request renames by the same roster; a failed read keeps the last.
                try { untoldRoster = untoldPeople(await rpc('table.untold', {})); } catch { /* the last roster stands */ }
                if (ticket !== generation || signal.aborted) return undefined;
                const source = briefingKey(binding, current);
                if (!brief || briefKey !== source) {
                    let full = current;
                    if (!rehydrated) {
                        const result = await rpc('table.capsule', {rehydrate: true});
                        if (ticket !== generation || signal.aborted) return undefined;
                        const {_context, ...read} = result, view = firstSightView(owner, read);
                        const actual = bindingOf(_context);
                        if (!actual || actual.campaign !== binding.campaign || actual.worldline !== binding.worldline
                            || actual.loop !== binding.loop || actual.turn !== binding.turn) return fail('rehydration_binding_changed');
                        // A reader may publish the book between player_input and this readonly hydration.
                        binding = actual; rawBinding = _context; current = view; capsule = view;
                        full = view; rehydrated = true;
                        expression.observe(view,{...object(_context),campaign:owner,turn:observedTurn??0},inputLifetime.signal);
                    }
                    brief = {kind: 'context_brief', head: 'Keeper-only current book, full craft context and active package instructions. Use with the current turn capsule; this is not player input.',
                        // §183.5: the rows' text only. An indexed row's section list and its per-turn gates stay out, so this stays cached.
                        module: full.module ?? null, style: full.style ?? null, instructions: (Array.isArray(object(full.mods).instructions) ? object(full.mods).instructions : [])
                            .map((value: Row) => ({mod: value.mod, version: value.version, settings: value.settings, form: value.form, instruction: value.instruction})),
                        truncated: Array.isArray(full.truncated) ? full.truncated.filter((section: string) => ['module', 'style'].includes(section)) : []};
                    briefKey = briefingKey(binding, full);
                }
                const quotes: Quote[] = [];
                let unavailable: string | undefined;
                const turns = [...new Set((Array.isArray(current.recent) ? current.recent : []).map((entry: Row) => entry.turn)
                    .filter((turn: unknown): turn is number => Number.isSafeInteger(turn) && Number(turn) < binding!.turn))].sort((a, b) => Number(a) - Number(b)).slice(-2) as number[];
                const wanted = turns.length ? turns : [binding.turn - 2, binding.turn - 1].filter(turn => turn >= 0);
                const recall = async (params: Row): Promise<Row> => {
                    const result = await rpc('table.recall', {...params, _context_read: true});
                    reads++; readBytes += sizeOf(result); return result;
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
                expression.observe({...current,expression_exchange:history},binding,inputLifetime.signal);
                // KIC-03 (contract §19.2): the optional workspace is host work behind the package's
                // own mode. Off, unknown or missing reads nothing; shadow reads and records only;
                // on injects. Any failure here is a miss on the optional layer, never a degraded turn.
                const workspaceMode = workspaceModeOf(current), workspaceBudget = workspaceBudgetOf(current);
                observedWorkspaceMode = workspaceMode;
                let workspace: Row | undefined;
                if (workspaceMode !== 'off' && !prescreenEnabled()) {
                    const began = Date.now();
                    try {
                        const settings = workspaceSettingsOf(current);
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
                    read_calls: reads, read_bytes: readBytes, rehydrated, ms: Date.now() - began,
                    ...(unavailable ? {history_unavailable: true} : {})});
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

    const diagnostic = (reason: string): Row => customMessage(DIAGNOSTIC_TYPE, {
        kind: 'context_diagnostic', reason,
        note: 'Some context could not be safely reduced and was retained. Preserve authoritative state and pending choices; do not invent missing history. This host notice is not a story event or a new obligation.',
    });
    pi.on('context', async (event, ctx) => {
        const ticket = generation;
        // §143.6: NPC advice is retired; a copy a session recorded before that never reaches the model.
        const requestMessages=event.messages.filter(message=>message.role!=='custom'||message.customType!==NPC_ADVICE_TYPE);
        let snapshot = await prepare();
        // A concurrent input may replace a generation while its optional work is awaiting I/O.
        // Try the current accepted binding once; an unaccepted input uses the normal fallback.
        if (!snapshot && ticket !== generation && !inputPending) snapshot = await prepare();
        // Pi 0.87 restores the canonical system/tool checkpoint after this hook. Reserve its
        // serialized size on every exit, including degraded turns, without treating it as history.
        let systemBytes = 0, systemDigest: string | null = null;
        if (typeof ctx.sessionManager?.buildSessionProjection === 'function') {
            const system = getCurrentSystemMessage(ctx.sessionManager.buildSessionProjection().messages);
            systemBytes = system ? sizeOf(system) + 1 : 0;
            // §184.3: the prompt text and the tool declarations the provider sees; the transcript timestamp is not sent.
            systemDigest = system ? shortDigest({content: system.content, sections: system.sections ?? null, tools: system.toolsAdded ?? []}) : null;
        } else {
            const active = typeof pi.getActiveTools === 'function' ? new Set(pi.getActiveTools()) : undefined;
            const tools = typeof pi.getAllTools === 'function' ? pi.getAllTools().filter(tool => !active || active.has(tool.name)) : [];
            const material = {system: typeof ctx.getSystemPrompt === 'function' ? ctx.getSystemPrompt() : '', tools};
            systemBytes = sizeOf(material); systemDigest = shortDigest(material);
        }
        const ceiling = requestBudget(ctx.model?.contextWindow), budget = Math.max(0, ceiling - systemBytes);
        if (!snapshot) {
            // No capsule means no projection, never an unbounded request: a long campaign's whole
            // stored branch is exactly what must not reach the provider on a degraded turn.
            // §176.8: renamed before the cut, so the ceiling measures the names and notes that go out.
            const rest = renameUntold((requestMessages as unknown as Row[]).filter(message => !(message.role === 'custom' && [DIAGNOSTIC_TYPE, PRESCREEN_TYPE].includes(message.customType))), untoldRoster);
            const notice = diagnostic(lastReason);
            const cut = boundedTail(rest, Math.max(0, budget - requestSize([notice])));
            const outgoing = renameUntold([notice, ...cut.messages], untoldRoster);
            record({lane: 'context', event: 'request', at: new Date().toISOString(), version: POLICY_VERSION, reason: lastReason,
                request_bytes: requestSize(outgoing) + systemBytes, system_bytes: systemBytes, system_digest: systemDigest, ...requestSegments(outgoing),
                local_token_estimate: Math.ceil((requestSize(outgoing) + systemBytes) / BYTES_PER_TOKEN),
                ceiling_bytes: ceiling, dropped_tail: cut.dropped, context_window: ctx.model?.contextWindow ?? null,
                ...(cut.over ? {capacity: 'request_ceiling_exceeded'} : {})});
            return {messages: outgoing as typeof requestMessages};
        }
        const messages = requestMessages as unknown as Row[];
        let seen = false;
        // §103.5: the capsule the Keeper is sent is this copy, not the persisted message; it carries the Keeper's untold view.
        const view = untoldView(structuredClone(snapshot.capsule)).capsule;
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
        selected.splice(0, selected.length, ...renameUntold(selected, untoldRoster));
        if (!seen && !messages.some(message => message.role === 'custom' && message.customType === 'coc-capsule')) {
            // A new opening/recovery may have only a host prompt; this ephemeral capsule is not persisted.
            selected.push({...customMessage('coc-capsule', capsuleSent), details: {coc_host: true, turn: snapshot.binding.turn, context: snapshot.binding}});
        }
        let workspace=snapshot.workspaceMode==='on'?snapshot.workspace:undefined,prescreen:Row|undefined;
        // §184.2: the single-loop engine's order puts the turn's capsule ahead of the history; the legacy engine's is unchanged.
        const project=(budget:number,optional:{workspace?:Row;prescreen?:Row}={})=>projectedMessages({messages:selected,binding:snapshot.binding,
            history:snapshot.history,brief:briefSent,answering:snapshot.answering,budget,...optional,...(runOwnsPrescreen?{capsuleFirst:true}:{})});
        let messageBudget=room,baseline=project(room,{workspace});
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
        if(materialEnabled&&port&&preparationCall&&preparationCampaign&&inputEpoch&&!prescreenDeadlineAt){
            const parent=foregroundBudget?.();prescreenDeadlineAt=Math.min(Date.now()+readJevPreselectAllowanceMs(sessionEnv),parent?.deadlineAt??Infinity);
            sharedBudget=preparationBudget({decision:port,campaign:preparationCampaign,deadlineAt:prescreenDeadlineAt,signal:inputLifetime.signal,parent});
            record({lane:'prescreen',owner:'keeper-preparation',event:'allowance_started',allowance_ms:readJevPreselectAllowanceMs(sessionEnv),
                effective_ms:Math.max(0,prescreenDeadlineAt-Date.now())});
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
                if(preparationSignal.aborted||ticket!==generation)return {messages:renameUntold(baseline.messages,untoldRoster) as typeof requestMessages};
                const refreshed=await preparePrescreen({call:preparationCall,campaign:preparationCampaign,binding:snapshot.binding,capsule:snapshot.capsule,
                    signal:preparationSignal,record:event=>{record(event);if(event.event==='prepared')refreshOutcome='prepared';
                        else if(event.event==='fallback')refreshOutcome='fallback';else if(event.event==='skipped')refreshOutcome=String(event.reason??'skipped');},
                    suppliedMessages:baseline.messages,byteBudget:supplementBudget,
                    deadlineAt:prescreenDeadlineAt,decision:sharedBudget?.decision,names:[...evidenceNames],rules:[...ruleNames],
                    providerBudget:prescreenProviderBudget,...(sourceRuntime&&moduleId?{source:{moduleId,runtime:sourceRuntime}}:{})});
                prescreen=refreshed??(needsReassessment&&['prepared','empty_catalog'].includes(refreshOutcome)?undefined:reused);
            }
            if(ticket!==generation||preparationSignal.aborted)return {messages:renameUntold(baseline.messages,untoldRoster) as typeof requestMessages};
            prescreenMemo={key:memoKey,message:prescreen};
            if(prescreen)reusablePrescreen=prescreen;
        }
        if(ticket!==generation||preparationSignal.aborted)return {messages:renameUntold(baseline.messages,untoldRoster) as typeof requestMessages};
        let result=prescreen?project(messageBudget,{workspace,prescreen}):baseline;
        const window = ctx.model?.contextWindow, available = typeof window === 'number' ? window - Math.min(16384, Math.floor(window / 4)) : Infinity;
        const reason = result.degraded ?? (Math.ceil((requestSize(result.messages) + systemBytes) / BYTES_PER_TOKEN) > available ? 'request_window_estimate' : undefined);
        // Reserve a diagnostic only when one is needed. An optional workspace must not be
        // displaced by a hypothetical notice on an otherwise healthy, within-budget request.
        if (reason) result = project(Math.max(0,messageBudget-requestSize([diagnostic(reason)])),{workspace,prescreen});
        const outgoing = renameUntold([...(reason ? [diagnostic(reason), ...result.messages.filter(message => !(message.role === 'custom' && message.customType === DIAGNOSTIC_TYPE))] : result.messages), ...turnTail]
            .filter(message=>!(message.role==='custom'&&[EXPRESSION_MESSAGE,MOD_SECTIONS_MESSAGE].includes(message.customType))), untoldRoster);
        // Contract §183.5: package sections this turn needs, at the end; nothing on a table whose instructions all go whole.
        pendingSections=undefined;
        modSections.observe(snapshot.capsule,snapshot.binding,inputLifetime.signal);
        await modSections.waitForFirst(preparationSignal);
        if(ticket!==generation||preparationSignal.aborted)return{messages:renameUntold(baseline.messages,untoldRoster) as typeof requestMessages};
        const sectionsMessage=await modSections.message(snapshot.capsule,snapshot.binding,turnCalls);
        if(ticket!==generation||preparationSignal.aborted)return{messages:renameUntold(baseline.messages,untoldRoster) as typeof requestMessages};
        if(sectionsMessage&&requestSize([...outgoing,sectionsMessage])+systemBytes<=ceiling
            &&Math.ceil((requestSize([...outgoing,sectionsMessage])+systemBytes)/BYTES_PER_TOKEN)<=available){
            outgoing.push(sectionsMessage);pendingSections=sectionsMessage;
        }else if(sectionsMessage)record({lane:'mod-sections',event:'omitted',turn:snapshot.binding.turn,reason:'request_ceiling',bytes:requestSize([sectionsMessage])});
        pendingExpression=undefined;
        const expressionView={...snapshot.capsule,expression_exchange:snapshot.history};
        expression.observe(expressionView,snapshot.binding,inputLifetime.signal);
        await expression.waitForFirst(expressionView,snapshot.binding,preparationSignal);
        if(ticket!==generation||preparationSignal.aborted)return{messages:renameUntold(baseline.messages,untoldRoster) as typeof requestMessages};
        // §103.5: the expression packet is host-written too; it reaches the Keeper by the same names.
        const projectedExpression=expression.project(expressionView,snapshot.binding);
        const expressionMessage=projectedExpression&&renameUntold([projectedExpression],untoldRoster)[0];
        if(ticket!==generation||preparationSignal.aborted)return{messages:renameUntold(baseline.messages,untoldRoster) as typeof requestMessages};
        if(expressionMessage&&requestSize([...outgoing,expressionMessage])+systemBytes<=ceiling
            &&Math.ceil((requestSize([...outgoing,expressionMessage])+systemBytes)/BYTES_PER_TOKEN)<=available){
            outgoing.push(expressionMessage);pendingExpression=expressionMessage;
        }
        const bytes = requestSize(outgoing) + systemBytes, estimatedTokens = Math.ceil(bytes / BYTES_PER_TOKEN);
        const requestId=`prescreen:${snapshot.binding.turn}:${++providerSequence}`;
        if(pendingExpression)pendingExpression.details.expression.request_id=requestId;
        pendingProvider=prescreen?{requestId,prepared:renameUntold([prescreen],untoldRoster)[0],outgoingDigest:fingerprint(outgoing)}:undefined;
        record({lane: 'context', event: 'request', at: new Date().toISOString(), version: POLICY_VERSION, turn: snapshot.binding.turn,request_id:requestId,
            history_bytes: sizeOf(snapshot.history), protected_bytes: result.protectedBytes, unknown_bytes: result.unknownBytes,
            ...(pendingExpression?{expression_injected:true,expression_bytes:requestSize([pendingExpression])}:{}),
            ...(pendingSections?{mod_sections_bytes:requestSize([pendingSections])}:{}),
            request_bytes: bytes, system_bytes: systemBytes, system_digest: systemDigest, local_token_estimate: estimatedTokens, context_window: window ?? null, ceiling_bytes: ceiling,
            ...(result.prescreenKept && prescreen ? {prescreen_bytes: requestSize([prescreen]), prescreen_injected: true} : {}),
            ...(turnTail.length ? {tail_bytes: requestSize(turnTail), tail: turnTail.map(message => message.customType)} : {}),
            ...(result.workspaceKept && workspace ? {workspace_bytes: requestSize([workspace])} : {}),
            ...(result.workspaceKept && workspace ? {workspace_evidence_injected: JSON.parse(String(workspace.content)).evidence.length} : {}),
            ...(result.droppedTail ? {dropped_tail: result.droppedTail} : {}),
            ...(result.droppedUnknown ? {dropped_unknown: result.droppedUnknown} : {}),
            ...(result.degraded ? {reason: result.degraded} : {}),
            ...(result.overCeiling ? {capacity: 'request_ceiling_exceeded'}
                : estimatedTokens > available ? {capacity: 'request_window_estimate'} : {}),
            ...requestSegments(outgoing)});
        return {messages: outgoing as typeof requestMessages};
    });
    // Public Pi seam after provider conversion. Observe only whether the exact prepared packet
    // survived serialization; never record headers, secrets or the private payload.
    pi.on('before_provider_request', event => {
        const sectionsSent=pendingSections;pendingSections=undefined;
        if(sectionsSent)modSections.delivered(sectionsSent,(event as unknown as Row).payload,payloadContains);
        const advice=pendingExpression;pendingExpression=undefined;
        let replacement:unknown;
        if(advice&&!expression.delivered(advice,(event as unknown as Row).payload,payloadContains))
            replacement=removeExpressionPayload((event as unknown as Row).payload,String(advice.content));
        const pending=pendingProvider;pendingProvider=undefined;if(!pending)return replacement;
        if(!pending.prepared)return replacement;
        const prepared=object(pending.prepared),meta=object(object(prepared.details).prescreen);
        if(!prepared.content){record({lane:'prescreen',event:'delivered',request_id:pending.requestId,delivered:false,reason:'not_prepared'});return replacement;}
        let retained=false;
        try{retained=payloadContains((event as unknown as Row).payload,String(prepared.content));}catch{/* Unserializable payload is unconfirmed. */}
        let content:Row={};try{content=object(JSON.parse(String(prepared.content)));}catch{/* malformed prepared content is unconfirmed */}
        const materials=Array.isArray(content.materials)?content.materials:[],keys=Array.isArray(meta.material_keys)?meta.material_keys:[];
        const retainedMaterials=retained?materials.map((material:Row,index:number)=>({key:keys[index]??`material:${index}`,
            digest:fingerprint(material.content??null),bytes:sizeOf(material.content??null),coverage:structuredClone(object(material.coverage))})):[];
        const omitted=retained?[]:keys.map((key:string)=>({key,reason:'provider_payload_mismatch'}));
        record({lane:'prescreen',event:'delivered',request_id:pending.requestId,prepared_digest:meta.prepared_digest??null,
            outgoing_digest:pending.outgoingDigest,delivered:retained,retained:retainedMaterials,omitted,
            coverage:structuredClone(object(content.coverage)),...(retained?{bytes:requestSize([prepared])}:{reason:'provider_payload_mismatch'})});
        return replacement;
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
