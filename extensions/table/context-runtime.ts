import {createDecisionAdapter} from '../../runtime/jev/decision-adapter.ts';
import {readJevApiKey,readJevPreselectAllowanceMs} from '../jev/agent/config.js';
import {preparationBudget,preparationProviderBudget} from '../../runtime/jev/preparation-budget.ts';
import type {DecisionPort} from '../../runtime/jev/decision-port.ts';
import type {TaskProviderBudget} from '../../runtime/jev/provider-budget.ts';
import type {NpcPreparationBridge,PreparedNpcAdvice} from '../npc/index.ts';
/** Request and persistence adapters for the one bounded play-context policy. */
import {createHash} from 'node:crypto';
import {dirname, join} from 'node:path';
import type {ExtensionAPI, ExtensionContext} from '@earendil-works/pi-coding-agent';
import {getCurrentSystemMessage} from '@earendil-works/pi-ai';
import {compactAt} from './fold.ts';
import {createWorkpadStore, type WorkpadView} from './workspace/workpad-store.ts';
import {selectWorkspace, workspaceBudgetOf, workspaceModeOf, workspaceSettingsOf, workspaceCandidates, type WorkspaceMode} from './workspace/projection.ts';
import {reuseEvidence, dormantEvidence} from './workspace/evidence.ts';
import {rankWorkspaceCandidates} from './workspace/reranker.ts';
import {preparePrescreen,prescreenEnabled,reusePrescreen} from './prescreen.ts';
import type {PrescreenSourceRuntime} from '../../runtime/jev/prescreen-source-provider.ts';
import {bindingOf, customMessage, epochOf, sourceOf, historyView, metadata, quoteView, briefForTurn, projectedMessages, foldPlan,
    boundedTail, requestBudget, BYTES_PER_TOKEN, HISTORY_BYTES, POLICY_VERSION, DIAGNOSTIC_TYPE, WORKSPACE_TYPE, PRESCREEN_TYPE, entryMessage, object, sizeOf, requestSize,
    type ContextBinding, type Quote, type Row} from './context-policy.ts';

type KernelCall = (method: string, params: Row) => Promise<unknown>;
type Prepared = {binding: ContextBinding; capsule: Row; history: Row; brief: Row; key: string; answering?: string[];
    workspace?: Row; workspaceMode: WorkspaceMode};
const fingerprint = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function payloadContains(value:unknown,content:string,seen=new Set<object>()):boolean {
    if(typeof value==='string')return value===content||value.includes(content);
    if(!value||typeof value!=='object'||seen.has(value as object))return false;seen.add(value as object);
    return (Array.isArray(value)?value:Object.values(value as Row)).some(child=>payloadContains(child,content,seen));
}

async function withinPreparation<T>(work:Promise<T>,parent:AbortSignal,deadlineAt:number):Promise<T>{
    const remaining=deadlineAt-Date.now();if(remaining<=0)throw new Error('preparation_expired');
    const signal=AbortSignal.any([parent,AbortSignal.timeout(Math.max(1,remaining))]);signal.throwIfAborted();
    let abort:()=>void=()=>{};
    try{return await Promise.race([work,new Promise<never>((_,reject)=>{abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true});})]);}
    finally{signal.removeEventListener('abort',abort);}
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
    let providerSequence=0,pendingProvider:{requestId:string;prepared?:Row;npc?:Row;outgoingDigest:string}|undefined;
    let npcBridge:NpcPreparationBridge|undefined,npcMemo:{key:string;prepared:PreparedNpcAdvice}|undefined;
    let sessionEnv={...process.env},sharedAdapter:DecisionPort|undefined,sharedBudget:ReturnType<typeof preparationBudget>|undefined;
    let inputLifetime=new AbortController(),foregroundBudget:(()=>TaskProviderBudget|undefined)|undefined;
    const decision=()=>{
        if(!readJevApiKey(sessionEnv))return undefined;
        const capacity=Number(sessionEnv.PI_COC_JEV_CONCURRENCY??16);
        return sharedAdapter??=createDecisionAdapter({env:sessionEnv,maxConcurrency:Number.isInteger(capacity)&&capacity>0?Math.min(capacity,16):16});
    };
    const resetPreparation=()=>{inputLifetime.abort();inputLifetime=new AbortController();sharedBudget?.close();sharedBudget=undefined;npcMemo=undefined;};
    pi.events.on('coc:npc-bridge',value=>{npcBridge=value&&typeof (value as any).prepare==='function'?value as NpcPreparationBridge:undefined;npcMemo=undefined;});
    pi.events.on('coc:task-provider-budget',value=>{foregroundBudget=typeof value==='function'?value as typeof foregroundBudget:undefined;});
    pi.events.emit?.('coc:npc-preparation-owner',{decision});
    let optionalWork = new AbortController();
    // Invalidating a snapshot must not disable its event subscriptions while rehydration waits.
    let observedWorkspaceMode: WorkspaceMode = 'off';
    const sourceCalls = new Set<string>();
    const stateCalls = new Set<string>();
    const reads = new Map<string, {kind: string; name?: string; query?: string}>();
    const evidenceNames = new Set<string>(), ruleNames = new Set<string>();
    const invalidate = (): void => {
        optionalWork.abort(); optionalWork = new AbortController();
        generation++; prepared = undefined; preparing = undefined;
    };
    const degraded = (reason: string): void => {
        lastReason = reason;
        const key = `${generation}:${reason}`;
        if (key !== lastDegraded) {lastDegraded = key; record({lane: 'context', event: 'degraded', reason});}
    };
    pi.on('input', async () => {inputPending=true;invalidate();});
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
    });
    // Contract §41.1: the input was refused, so no turn opened and no capsule is coming to clear the latch
    // this input set. Nothing at the table moved either, so the held capsule and binding are still the last
    // ones the host published: undo the latch and let the next request prepare against them. Without this,
    // every request until the next accepted input runs degraded on `player_input_not_accepted`.
    pi.events.on('coc:input-refused', () => {inputPending = false; invalidate();});
    pi.events.on('coc:source-published', data => {
        if (observedWorkspaceMode === 'off' && !prescreenEnabled() || object(data).campaign && object(data).campaign !== campaign) return;
        capsule = undefined; rawBinding = undefined; brief = undefined; briefKey = undefined; prescreenMemo=undefined;reusablePrescreen=undefined; invalidate();
    });
    pi.on('tool_call', async event => {
        const input = object(event.input);
        if (event.toolName === 'look' || event.toolName === 'lookup')
            reads.set(event.toolCallId, {kind: String(input.kind ?? input.focus ?? ''),
                name: typeof input.name === 'string' ? input.name : undefined,
                query: typeof input.query === 'string' ? input.query : undefined});
        if (['apply', 'resolve', 'narrate', 'ask'].includes(event.toolName)) stateCalls.add(event.toolCallId);
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
        const stateChanged = stateCalls.delete(event.toolCallId);
        const sourceChanged = sourceCalls.delete(event.toolCallId);
        // A failed transport can hide a committed mutation. Re-read the actual kernel state;
        // never infer arrival or settlement from the requested effect or an error flag.
        if (!sourceChanged && !captured && !(stateChanged && (observedWorkspaceMode !== 'off' || prescreenEnabled()))) return;
        capsule = undefined; rawBinding = undefined; brief = undefined; briefKey = undefined; invalidate();
    });
    pi.on('session_start', async () => {resetPreparation();sessionEnv={...process.env};sharedAdapter=undefined;invalidate(); observedWorkspaceMode = 'off'; inputPending = false; brief = undefined; briefKey = undefined; lastFold = undefined;
        lastAttempt = undefined; sourceCalls.clear(); stateCalls.clear();prescreenDeadlineAt=0;prescreenMemo=undefined;reusablePrescreen=undefined;
        prescreenProviderBudget=preparationProviderBudget();});
    pi.on('session_shutdown', async () => {resetPreparation();sharedAdapter=undefined;pi.events.emit?.('coc:npc-preparation-owner',undefined);call=undefined;capsule=undefined;rawBinding=undefined;sourceRuntime=undefined;moduleId=undefined;observedWorkspaceMode='off';
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
                    const {_context, ...view} = result;
                    binding = bindingOf(_context); current = view;
                    if (!binding) return fail('context_binding_unavailable');
                    rawBinding = _context; capsule = view; rehydrated = true;
                }
                const source = sourceOf(binding);
                if (!brief || briefKey !== source) {
                    let full = current;
                    if (!rehydrated) {
                        const result = await rpc('table.capsule', {rehydrate: true});
                        if (ticket !== generation || signal.aborted) return undefined;
                        const {_context, ...view} = result;
                        const actual = bindingOf(_context);
                        if (!actual || actual.campaign !== binding.campaign || actual.worldline !== binding.worldline
                            || actual.loop !== binding.loop || actual.turn !== binding.turn) return fail('rehydration_binding_changed');
                        // A reader may publish the book between player_input and this readonly hydration.
                        binding = actual; rawBinding = _context; current = view; capsule = view;
                        full = view; rehydrated = true;
                    }
                    brief = {kind: 'context_brief', head: 'Keeper-only current book, full craft context and active package instructions. Use with the current turn capsule; this is not player input.',
                        module: full.module ?? null, style: full.style ?? null, instructions: object(full.mods).instructions ?? [],
                        truncated: Array.isArray(full.truncated) ? full.truncated.filter((section: string) => ['module', 'style'].includes(section)) : []};
                    briefKey = sourceOf(binding);
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
        const requestMessages=event.messages.filter(message=>message.role!=='custom'||message.customType!=='coc-npc-advice');
        let snapshot = await prepare();
        // A concurrent input may replace a generation while its optional work is awaiting I/O.
        // Try the current accepted binding once; an unaccepted input uses the normal fallback.
        if (!snapshot && ticket !== generation && !inputPending) snapshot = await prepare();
        // Pi 0.87 restores the canonical system/tool checkpoint after this hook. Reserve its
        // serialized size on every exit, including degraded turns, without treating it as history.
        let systemBytes = 0;
        if (typeof ctx.sessionManager?.buildSessionProjection === 'function') {
            const system = getCurrentSystemMessage(ctx.sessionManager.buildSessionProjection().messages);
            systemBytes = system ? sizeOf(system) + 1 : 0;
        } else {
            const active = typeof pi.getActiveTools === 'function' ? new Set(pi.getActiveTools()) : undefined;
            const tools = typeof pi.getAllTools === 'function' ? pi.getAllTools().filter(tool => !active || active.has(tool.name)) : [];
            systemBytes = sizeOf({system: typeof ctx.getSystemPrompt === 'function' ? ctx.getSystemPrompt() : '', tools});
        }
        const ceiling = requestBudget(ctx.model?.contextWindow), budget = Math.max(0, ceiling - systemBytes);
        if (!snapshot) {
            // No capsule means no projection, never an unbounded request: a long campaign's whole
            // stored branch is exactly what must not reach the provider on a degraded turn.
            const rest = (requestMessages as unknown as Row[]).filter(message => !(message.role === 'custom' && [DIAGNOSTIC_TYPE, PRESCREEN_TYPE].includes(message.customType)));
            const notice = diagnostic(lastReason);
            const cut = boundedTail(rest, Math.max(0, budget - requestSize([notice])));
            const outgoing = [notice, ...cut.messages];
            record({lane: 'context', event: 'request', version: POLICY_VERSION, reason: lastReason,
                request_bytes: requestSize(outgoing) + systemBytes, system_bytes: systemBytes,
                local_token_estimate: Math.ceil((requestSize(outgoing) + systemBytes) / BYTES_PER_TOKEN),
                ceiling_bytes: ceiling, dropped_tail: cut.dropped, context_window: ctx.model?.contextWindow ?? null,
                ...(cut.over ? {capacity: 'request_ceiling_exceeded'} : {})});
            return {messages: outgoing as typeof requestMessages};
        }
        const messages = requestMessages as unknown as Row[];
        let seen = false;
        const view = structuredClone(snapshot.capsule);
        // The immutable full briefing already has these fields; retain the turn-specific craft selection.
        delete view.module;
        if (view.mods) {view.mods = {...view.mods}; delete view.mods.instructions;}
        const selected = messages.map(message => {
            const actual = bindingOf(object(message.details).context);
            const sameInput = inputEpoch && object(message.details).epoch === inputEpoch;
            if (message.role !== 'custom' || message.customType !== 'coc-capsule' || !sameInput && (!actual || epochOf(actual) !== snapshot.key)) return message;
            seen = true;
            return {...message, content: JSON.stringify(view), details: {...object(message.details), context: snapshot.binding}};
        })
            // The workspace is transport-only: at most one current message, injected below for this
            // request. A persisted copy from anywhere is dropped here, not projected onward.
            .filter(message => !(message.role === 'custom' && [WORKSPACE_TYPE, PRESCREEN_TYPE].includes(message.customType)));
        if (!seen && !messages.some(message => message.role === 'custom' && message.customType === 'coc-capsule')) {
            // A new opening/recovery may have only a host prompt; this ephemeral capsule is not persisted.
            selected.push({...customMessage('coc-capsule', view), details: {coc_host: true, turn: snapshot.binding.turn, context: snapshot.binding}});
        }
        let workspace=snapshot.workspaceMode==='on'?snapshot.workspace:undefined,prescreen:Row|undefined;
        let messageBudget=budget,baseline=projectedMessages({messages:selected,binding:snapshot.binding,history:snapshot.history,
            brief:briefForTurn(snapshot.brief,view),answering:snapshot.answering,budget,workspace});
        // Compute the actual baseline only after system/tool/output reserves are known. Material
        // missing from this projection is not "already supplied" to the Keeper.
        try {
            const reserve=Math.min(16384,Math.floor((ctx.model?.contextWindow??65536)/4))*BYTES_PER_TOKEN;
            const totalLimit=Math.min(ceiling,(ctx.model?.contextWindow??Infinity)*BYTES_PER_TOKEN-reserve);
            messageBudget=Math.max(0,Math.min(budget,totalLimit-systemBytes));
            baseline=projectedMessages({messages:selected,binding:snapshot.binding,history:snapshot.history,
                brief:briefForTurn(snapshot.brief,view),answering:snapshot.answering,budget:messageBudget,workspace});
            if(!baseline.workspaceKept)workspace=undefined;
        } catch {
            workspace=undefined;
            baseline=projectedMessages({messages:selected,binding:snapshot.binding,history:snapshot.history,
                brief:briefForTurn(snapshot.brief,view),answering:snapshot.answering,budget:messageBudget});
        }
        const supplementBudget=Math.max(0,messageBudget-requestSize(baseline.messages));
        const preparationSignal=optionalWork.signal,preparationCall=call,preparationCampaign=campaign,npcOwner=npcBridge;
        const npcWait=npcBridge?.automaticWaitMs()??0,materialEnabled=prescreenEnabled()&&supplementBudget>=512;
        const port=decision();let npcWork:Promise<PreparedNpcAdvice|undefined>|undefined,npcMessage:Row|undefined;
        const npcKey=fingerprint([generation,snapshot.key,snapshot.binding]);
        let sharedSnapshot:Promise<Row|undefined>|undefined;
        if((materialEnabled||npcWait>0)&&port&&preparationCall&&preparationCampaign&&inputEpoch){
            if(!prescreenDeadlineAt){
                const parent=foregroundBudget?.();prescreenDeadlineAt=Math.min(Date.now()+(materialEnabled?readJevPreselectAllowanceMs(sessionEnv):npcWait),parent?.deadlineAt??Infinity);
                sharedBudget=preparationBudget({decision:port,campaign:preparationCampaign,deadlineAt:prescreenDeadlineAt,signal:inputLifetime.signal,parent});
                record({lane:materialEnabled?'prescreen':'preparation',owner:'keeper-preparation',event:'allowance_started',allowance_ms:materialEnabled?readJevPreselectAllowanceMs(sessionEnv):npcWait,
                    effective_ms:Math.max(0,prescreenDeadlineAt-Date.now())});
            }
            if(materialEnabled&&npcWait>0&&Date.now()<prescreenDeadlineAt){
                sharedSnapshot=withinPreparation(preparationCall('table.workspace.read',{campaign:preparationCampaign,preselect:{version:2,mode:'catalog',cursor:0,limit:48},
                    query:String(object(snapshot.capsule.turn).player_text??''),names:[...evidenceNames],rules:[...ruleNames],candidate_limit:48,npc_perspectives:true}),
                    preparationSignal,prescreenDeadlineAt).then(object).catch(()=>undefined);
            }
            if(npcWait>0&&npcBridge&&Date.now()<prescreenDeadlineAt){
                const npcDeadline=Math.min(prescreenDeadlineAt,Date.now()+npcWait),owner=npcBridge,ownerCampaign=preparationCampaign,ownerDecision=sharedBudget?.decision;
                npcWork=npcMemo?.key===npcKey?Promise.resolve(npcMemo.prepared):(async()=>{
                    const seed=await sharedSnapshot;
                    if(preparationSignal.aborted||ticket!==generation||!ownerDecision)return undefined;
                    return owner.prepare({campaign:ownerCampaign,automatic:true,decision:ownerDecision,signal:preparationSignal,
                        deadlineAt:npcDeadline,...(Array.isArray(seed?.npc_perspectives)?{snapshots:seed.npc_perspectives}:{})});
                })().catch(()=>undefined);
            }
        }

        if(prescreenEnabled()&&supplementBudget>=512&&preparationCall&&preparationCampaign&&inputEpoch){
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
                const initialSnapshot=await sharedSnapshot;
                if(preparationSignal.aborted||ticket!==generation)return {messages:baseline.messages as typeof requestMessages};
                const refreshed=await preparePrescreen({call:preparationCall,campaign:preparationCampaign,binding:snapshot.binding,capsule:snapshot.capsule,initialSnapshot,
                    signal:preparationSignal,record:event=>{record(event);if(event.event==='prepared')refreshOutcome='prepared';
                        else if(event.event==='fallback')refreshOutcome='fallback';else if(event.event==='skipped')refreshOutcome=String(event.reason??'skipped');},
                    suppliedMessages:baseline.messages,byteBudget:supplementBudget,
                    deadlineAt:prescreenDeadlineAt-(npcWork?500:0),decision:sharedBudget?.decision,names:[...evidenceNames],rules:[...ruleNames],
                    providerBudget:prescreenProviderBudget,...(sourceRuntime&&moduleId?{source:{moduleId,runtime:sourceRuntime}}:{})});
                prescreen=refreshed??(needsReassessment&&['prepared','empty_catalog'].includes(refreshOutcome)?undefined:reused);
            }
            if(ticket!==generation||preparationSignal.aborted)return {messages:baseline.messages as typeof requestMessages};
            prescreenMemo={key:memoKey,message:prescreen};
            if(prescreen)reusablePrescreen=prescreen;
        }
        if(npcWork&&npcOwner&&preparationCampaign){
            const preparedNpc=await npcWork;
            if(preparedNpc&&ticket===generation&&!preparationSignal.aborted){
                npcMemo={key:npcKey,prepared:preparedNpc};
                const currentNpc=await npcOwner.finalize(preparedNpc,{campaign:preparationCampaign,signal:preparationSignal,deadlineAt:prescreenDeadlineAt});
                const ready=(Array.isArray(currentNpc.advice)?currentNpc.advice:[]).filter((row:Row)=>row.status==='ready');
                const content={kind:'npc_response_advice',advice:[] as Row[],omitted:0,
                    note:'Optional intentions, not facts or executed actions. Preserve player choices and ordinary effect receipts. Direct answers and natural closure remain valid.'};
                for(const row of ready){const value={npc:row.npc,selected:row.selected};
                    if(sizeOf({...content,advice:[...content.advice,value]})<=4096)content.advice.push(value);else content.omitted++;}
                if(content.advice.length)npcMessage=customMessage('coc-npc-advice',content);
                record({lane:'npc',event:'finalized',ready:content.advice.length,omitted:content.omitted,
                    outcomes:(Array.isArray(currentNpc.advice)?currentNpc.advice:[]).map((row:Row)=>({npc:row.npc,status:row.status,reason:row.reason}))});
            }
        }
        if(ticket!==generation||preparationSignal.aborted)return {messages:baseline.messages as typeof requestMessages};
        let result=(prescreen||npcMessage)?projectedMessages({messages:selected,binding:snapshot.binding,history:snapshot.history,
            brief:briefForTurn(snapshot.brief,view),answering:snapshot.answering,budget:messageBudget,workspace,prescreen,npc:npcMessage}):baseline;
        const window = ctx.model?.contextWindow, available = typeof window === 'number' ? window - Math.min(16384, Math.floor(window / 4)) : Infinity;
        const reason = result.degraded ?? (Math.ceil((requestSize(result.messages) + systemBytes) / BYTES_PER_TOKEN) > available ? 'request_window_estimate' : undefined);
        // Reserve a diagnostic only when one is needed. An optional workspace must not be
        // displaced by a hypothetical notice on an otherwise healthy, within-budget request.
        if (reason) result = projectedMessages({messages:selected,binding:snapshot.binding,history:snapshot.history,
            brief:briefForTurn(snapshot.brief,view),answering:snapshot.answering,
            budget:Math.max(0,messageBudget-requestSize([diagnostic(reason)])),workspace,prescreen,npc:npcMessage});
        const outgoing = reason ? [diagnostic(reason), ...result.messages.filter(message => !(message.role === 'custom' && message.customType === DIAGNOSTIC_TYPE))] : result.messages;
        const bytes = requestSize(outgoing) + systemBytes, estimatedTokens = Math.ceil(bytes / BYTES_PER_TOKEN);
        const requestId=`prescreen:${snapshot.binding.turn}:${++providerSequence}`;
        pendingProvider=prescreen||npcMessage?{requestId,prepared:prescreen,npc:npcMessage,outgoingDigest:fingerprint(outgoing)}:undefined;
        record({lane: 'context', event: 'request', version: POLICY_VERSION, turn: snapshot.binding.turn,request_id:requestId,
            history_bytes: sizeOf(snapshot.history), protected_bytes: result.protectedBytes, unknown_bytes: result.unknownBytes,
            request_bytes: bytes, system_bytes: systemBytes, local_token_estimate: estimatedTokens, context_window: window ?? null, ceiling_bytes: ceiling,
            ...(result.prescreenKept && prescreen ? {prescreen_bytes: requestSize([prescreen]), prescreen_injected: true} : {}),
            ...(result.workspaceKept && workspace ? {workspace_bytes: requestSize([workspace])} : {}),
            ...(result.workspaceKept && workspace ? {workspace_evidence_injected: JSON.parse(String(workspace.content)).evidence.length} : {}),
            ...(result.droppedTail ? {dropped_tail: result.droppedTail} : {}),
            ...(result.droppedUnknown ? {dropped_unknown: result.droppedUnknown} : {}),
            ...(result.degraded ? {reason: result.degraded} : {}),
            ...(result.overCeiling ? {capacity: 'request_ceiling_exceeded'}
                : estimatedTokens > available ? {capacity: 'request_window_estimate'} : {})});
        return {messages: outgoing as typeof requestMessages};
    });
    // Public Pi seam after provider conversion. Observe only whether the exact prepared packet
    // survived serialization; never record headers, secrets or the private payload.
    pi.on('before_provider_request', event => {
        const pending=pendingProvider;pendingProvider=undefined;if(!pending)return;
        if(pending.npc){let delivered=false;try{delivered=payloadContains((event as unknown as Row).payload,String(pending.npc.content));}catch{}
            record({lane:'npc',event:'delivered',request_id:pending.requestId,delivered,content_digest:fingerprint(pending.npc.content)});}
        if(!pending.prepared)return;
        const prepared=object(pending.prepared),meta=object(object(prepared.details).prescreen);
        if(!prepared.content){record({lane:'prescreen',event:'delivered',request_id:pending.requestId,delivered:false,reason:'not_prepared'});return;}
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
