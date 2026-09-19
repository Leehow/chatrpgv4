/** Request and persistence adapters for the one bounded play-context policy. */
import {createHash} from 'node:crypto';
import type {ExtensionAPI, ExtensionContext} from '@earendil-works/pi-coding-agent';
import {compactAt} from './fold.ts';
import {createWorkpadStore, type WorkpadView} from './workspace/workpad-store.ts';
import {selectWorkspace, workspaceBudgetOf, workspaceModeOf, type WorkspaceMode} from './workspace/projection.ts';
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
    const sourceCalls = new Set<string>();
    const invalidate = (): void => {generation++; prepared = undefined; preparing = undefined;};
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
        if (changed) invalidate();
    });
    pi.events.on('coc:table-open', data => {
        const turn = object(object(object(data).open).turn).number;
        if (Number.isSafeInteger(turn)) observedTurn = turn;
    });
    pi.events.on('coc:capsule', data => {
        const value = object(data);
        inputPending = false;
        capsule = value.capsule ? structuredClone(value.capsule) : undefined;
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
    pi.on('tool_call', async event => {
        const input = object(event.input);
        if (event.toolName === 'lookup' && input.kind === 'source'
            || event.toolName === 'apply' && Array.isArray(input.effects) && input.effects.some((effect: Row) => effect.kind === 'adaptation'))
            sourceCalls.add(event.toolCallId);
    });
    pi.on('tool_result', async event => {
        if (!sourceCalls.delete(event.toolCallId)) return;
        capsule = undefined; rawBinding = undefined; brief = undefined; briefKey = undefined; invalidate();
    });
    pi.on('session_start', async () => {invalidate(); inputPending = false; brief = undefined; briefKey = undefined; lastFold = undefined; lastAttempt = undefined; sourceCalls.clear();});
    pi.on('session_shutdown', async () => {call = undefined; capsule = undefined; rawBinding = undefined; invalidate();});

    async function prepare(): Promise<Prepared | undefined> {
        if (inputPending) {failedGeneration = generation; degraded('player_input_not_accepted'); return undefined;}
        if (failedGeneration === generation) return undefined;
        if (prepared) return prepared;
        if (preparing) return preparing;
        const ticket = generation, bridge = call, owner = campaign;
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
                let workspace: Row | undefined;
                if (workspaceMode !== 'off') {
                    const began = Date.now();
                    try {
                        const snapshot = await rpc('table.workspace.read', {});
                        if (ticket !== generation) return undefined;
                        const candidatePool = object(snapshot.candidates), candidates = [
                            ...(Array.isArray(candidatePool.static) ? candidatePool.static : []),
                            ...(Array.isArray(candidatePool.records) ? candidatePool.records : []),
                        ].map(value => object(value));
                        const query = String(object(current.turn).player_text ?? '');
                        const rerank = await rankWorkspaceCandidates({query, candidates});
                        if (rerank.status !== 'skipped') record({lane: 'workspace-rerank', event: rerank.status,
                            reason: rerank.status === 'fallback' ? rerank.reason : undefined, candidates: rerank.candidates,
                            ms: rerank.ms, ...(rerank.provider ? {provider: rerank.provider} : {}),
                            ...(rerank.model ? {model: rerank.model} : {})});
                        // KIC-04: the Keeper's own published workpad joins the same selection. Any
                        // failure here — root, store, corrupt file — is a miss on the optional layer,
                        // never a degraded selection and never a degraded request.
                        let workpad: WorkpadView | undefined;
                        try {
                            const root = workpadRoot?.();
                            if (root) {
                                const read = await createWorkpadStore(root)
                                    .read({campaign: binding.campaign, worldline: binding.worldline, loop: binding.loop});
                                if (read.status === 'ok') workpad = read.view;
                            }
                        } catch { workpad = undefined; }
                        const selection = selectWorkspace({snapshot, binding, budget: workspaceBudget, workpad,
                            ...(rerank.status === 'ranked' || rerank.status === 'cache' || rerank.status === 'fallback'
                                ? {rankedLocators: rerank.order} : {})});
                        if (selection.status === 'selected') {
                            workspace = selection.message;
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
        const snapshot = await prepare();
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
        const workspace = snapshot.workspaceMode === 'on' ? snapshot.workspace : undefined;
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
        const rawPressure = retainedBytes > HISTORY_BYTES * 4;
        const tokenPressure = typeof usage?.percent === 'number' && usage.percent >= compactAt() * 100;
        if (!rawPressure && !tokenPressure) return;
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
