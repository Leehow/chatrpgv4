/** Request and persistence adapters for the one bounded play-context policy. */
import {createHash} from 'node:crypto';
import {dirname, join} from 'node:path';
import type {ExtensionAPI, ExtensionContext} from '@earendil-works/pi-coding-agent';
import {compactAt} from './fold.ts';
import {createWorkpadStore, type WorkpadView} from './workspace/workpad-store.ts';
import {selectWorkspace, workspaceBudgetOf, workspaceModeOf, workspaceSettingsOf, workspaceCandidates, type WorkspaceMode} from './workspace/projection.ts';
import {reuseEvidence, dormantEvidence} from './workspace/evidence.ts';
import {rankWorkspaceCandidates} from './workspace/reranker.ts';
import {bindingOf, customMessage, epochOf, sourceOf, historyView, metadata, quoteView, briefForTurn, projectedMessages, foldPlan,
    boundedTail, requestBudget, BYTES_PER_TOKEN, HISTORY_BYTES, POLICY_VERSION, DIAGNOSTIC_TYPE, WORKSPACE_TYPE, entryMessage, object, sizeOf,
    type ContextBinding, type Quote, type Row} from './context-policy.ts';

type KernelCall = (method: string, params: Row) => Promise<unknown>;
type Prepared = {binding: ContextBinding; capsule: Row; history: Row; brief: Row; key: string; answering?: string[];
    workspace?: Row; workspaceMode: WorkspaceMode};
const fingerprint = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function installContextPolicy(pi: ExtensionAPI, writeTelemetry: (row: Row) => void,
    workpadRoot?: () => string | undefined): void {
    let observedTurn: number | undefined;
    const record = (row: Row): void => writeTelemetry({...(observedTurn === undefined ? {} : {turn: observedTurn}), ...row});
    let failedGeneration: number | undefined, inputPending = false;
    let call: KernelCall | undefined, campaign: string | undefined, capsule: Row | undefined, rawBinding: unknown;
    let answering: string[] | undefined, inputEpoch: string | undefined, generation = 0, prepared: Prepared | undefined;
    let preparing: Promise<Prepared | undefined> | undefined, brief: Row | undefined, briefKey: string | undefined;
    let lastFold: string | undefined, lastAttempt: string | undefined, lastDegraded: string | undefined;
    let lastReason = 'context_unavailable';
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
    pi.on('input', async () => {inputPending = true; invalidate();});
    pi.events.on('coc:kernel-bridge', data => {
        const value = object(data), nextCall = typeof value.call === 'function' ? value.call : undefined;
        const nextCampaign = typeof value.campaign === 'string' ? value.campaign : undefined;
        const changed = call !== nextCall || campaign !== nextCampaign;
        call = nextCall; campaign = nextCampaign;
        if (changed) {observedWorkspaceMode = 'off'; invalidate();}
    });
    pi.events.on('coc:table-open', data => {
        const turn = object(object(object(data).open).turn).number;
        if (Number.isSafeInteger(turn)) observedTurn = turn;
    });
    pi.events.on('coc:capsule', data => {
        const value = object(data);
        inputPending = false;
        capsule = value.capsule ? structuredClone(value.capsule) : undefined;
        observedWorkspaceMode = workspaceModeOf(capsule);
        if (Number.isSafeInteger(object(capsule?.turn).number)) observedTurn = object(capsule?.turn).number;
        rawBinding = value.context;
        inputEpoch = typeof value.epoch === 'string' ? value.epoch : undefined;
        answering = Array.isArray(value.answering) ? value.answering.filter((entry: unknown) => typeof entry === 'string') : undefined;
        sourceCalls.clear(); invalidate();
    });
    // Contract §41.1: the input was refused, so no turn opened and no capsule is coming to clear the latch
    // this input set. Nothing at the table moved either, so the held capsule and binding are still the last
    // ones the host published: undo the latch and let the next request prepare against them. Without this,
    // every request until the next accepted input runs degraded on `player_input_not_accepted`.
    pi.events.on('coc:input-refused', () => {inputPending = false; invalidate();});
    pi.events.on('coc:source-published', data => {
        if (observedWorkspaceMode === 'off' || object(data).campaign && object(data).campaign !== campaign) return;
        capsule = undefined; rawBinding = undefined; brief = undefined; briefKey = undefined; invalidate();
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
        if (read && !event.isError && observedWorkspaceMode !== 'off') {
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
        if (!sourceChanged && !captured && !(stateChanged && observedWorkspaceMode !== 'off')) return;
        capsule = undefined; rawBinding = undefined; brief = undefined; briefKey = undefined; invalidate();
    });
    pi.on('session_start', async () => {invalidate(); observedWorkspaceMode = 'off'; inputPending = false; brief = undefined; briefKey = undefined; lastFold = undefined; lastAttempt = undefined; sourceCalls.clear(); stateCalls.clear();});
    pi.on('session_shutdown', async () => {call = undefined; capsule = undefined; rawBinding = undefined; observedWorkspaceMode = 'off'; invalidate();});

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
                if (workspaceMode !== 'off') {
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
                            ms: rerank.ms, ...(rerank.provider ? {provider: rerank.provider} : {}),
                            ...(rerank.model ? {model: rerank.model} : {})});
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
        let snapshot = await prepare();
        // A concurrent input may replace a generation while its optional work is awaiting I/O.
        // Try the current accepted binding once; an unaccepted input uses the normal fallback.
        if (!snapshot && ticket !== generation && !inputPending) snapshot = await prepare();
        // The host notice can be prepended on any exit, so the ceiling reserves room for it.
        const ceiling = requestBudget(ctx.model?.contextWindow), budget = Math.max(0, ceiling - sizeOf([diagnostic('reserve')]));
        if (!snapshot) {
            // No capsule means no projection, never an unbounded request: a long campaign's whole
            // stored branch is exactly what must not reach the provider on a degraded turn.
            const rest = (event.messages as unknown as Row[]).filter(message => !(message.role === 'custom' && message.customType === DIAGNOSTIC_TYPE));
            const notice = diagnostic(lastReason);
            const cut = boundedTail(rest, budget);
            const outgoing = [notice, ...cut.messages];
            record({lane: 'context', event: 'request', version: POLICY_VERSION, reason: lastReason,
                request_bytes: sizeOf(outgoing), local_token_estimate: Math.ceil(sizeOf(outgoing) / BYTES_PER_TOKEN),
                ceiling_bytes: ceiling, dropped_tail: cut.dropped, context_window: ctx.model?.contextWindow ?? null,
                ...(cut.over ? {capacity: 'request_ceiling_exceeded'} : {})});
            return {messages: outgoing as typeof event.messages};
        }
        const messages = event.messages as unknown as Row[];
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
            .filter(message => !(message.role === 'custom' && message.customType === WORKSPACE_TYPE));
        if (!seen && !messages.some(message => message.role === 'custom' && message.customType === 'coc-capsule')) {
            // A new opening/recovery may have only a host prompt; this ephemeral capsule is not persisted.
            selected.push({...customMessage('coc-capsule', view), details: {coc_host: true, turn: snapshot.binding.turn, context: snapshot.binding}});
        }
        let workspace = snapshot.workspaceMode === 'on' ? snapshot.workspace : undefined;
        // The context event contains messages only. Optional evidence must also leave room for
        // the actual system prompt, tool schemas and output reservation in the provider request.
        if (workspace) {
            try {
                const active = typeof pi.getActiveTools === 'function' ? new Set(pi.getActiveTools()) : undefined;
                const tools = typeof pi.getAllTools === 'function' ? pi.getAllTools().filter(tool => !active || active.has(tool.name)) : [];
                const overhead = sizeOf({system: typeof ctx.getSystemPrompt === 'function' ? ctx.getSystemPrompt() : '', tools});
                const baseline = projectedMessages({messages: selected, binding: snapshot.binding, history: snapshot.history,
                    brief: briefForTurn(snapshot.brief, view), answering: snapshot.answering, budget});
                const reserve = Math.min(16384, Math.floor((ctx.model?.contextWindow ?? 65536) / 4)) * BYTES_PER_TOKEN;
                const totalLimit = Math.min(ceiling, (ctx.model?.contextWindow ?? Infinity) * BYTES_PER_TOKEN - reserve);
                if (sizeOf(baseline.messages) + sizeOf(workspace) + overhead > totalLimit) workspace = undefined;
            } catch {workspace = undefined;}
        }
        const result = projectedMessages({messages: selected, binding: snapshot.binding, history: snapshot.history,
            brief: briefForTurn(snapshot.brief, view), answering: snapshot.answering, budget, workspace});
        const window = ctx.model?.contextWindow, available = typeof window === 'number' ? window - Math.min(16384, Math.floor(window / 4)) : Infinity;
        const reason = result.degraded ?? (Math.ceil(sizeOf(result.messages) / BYTES_PER_TOKEN) > available ? 'request_window_estimate' : undefined);
        const outgoing = reason ? [diagnostic(reason), ...result.messages.filter(message => !(message.role === 'custom' && message.customType === DIAGNOSTIC_TYPE))] : result.messages;
        const bytes = sizeOf(outgoing), estimatedTokens = Math.ceil(bytes / BYTES_PER_TOKEN);
        record({lane: 'context', event: 'request', version: POLICY_VERSION, turn: snapshot.binding.turn,
            history_bytes: sizeOf(snapshot.history), protected_bytes: result.protectedBytes, unknown_bytes: result.unknownBytes,
            request_bytes: bytes, local_token_estimate: estimatedTokens, context_window: window ?? null, ceiling_bytes: ceiling,
            ...(result.workspaceKept && workspace ? {workspace_bytes: sizeOf(workspace)} : {}),
            ...(result.workspaceKept && workspace ? {workspace_evidence_injected: JSON.parse(String(workspace.content)).evidence.length} : {}),
            ...(result.droppedTail ? {dropped_tail: result.droppedTail} : {}),
            ...(result.droppedUnknown ? {dropped_unknown: result.droppedUnknown} : {}),
            ...(result.degraded ? {reason: result.degraded} : {}),
            ...(result.overCeiling ? {capacity: 'request_ceiling_exceeded'}
                : estimatedTokens > available ? {capacity: 'request_window_estimate'} : {})});
        return {messages: outgoing as typeof event.messages};
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
            return message ? [message] : [];
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
