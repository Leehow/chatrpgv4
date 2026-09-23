/** One deterministic policy for request-local history and persisted COC folds. */
import {buildSessionProjection, convertToLlm, type SessionEntry} from '@earendil-works/pi-coding-agent';
export const HISTORY_BYTES = 32 * 1024;
export const HISTORY_METADATA_BYTES = 4096;
/**
 * The whole-request ceiling. Campaign length must never push a request past it: the bounded
 * brief and history stand in for everything older, and older material stays reachable through
 * `table.recall`. Configuration only, never content: `PI_COC_REQUEST_BYTES` overrides the
 * default, and a known model window clamps it so the local estimate cannot claim the window.
 */
export const REQUEST_BYTES = 384 * 1024;
/** The local estimate the request path already uses; measured to over-report real tokens. */
export const BYTES_PER_TOKEN = 4;
/** Retained pre-boundary material is the first thing the ceiling gives up. */
export const UNCLASSIFIED_BYTES = 16 * 1024;
export const HISTORY_TYPE = 'coc-history';
export const BRIEF_TYPE = 'coc-context-brief';
export const DIAGNOSTIC_TYPE = 'coc-context-status';
/** Transport-only KIC workspace (contract §19.2): injected per request, never persisted. */
export const WORKSPACE_TYPE = 'coc-workspace';
export const PRESCREEN_TYPE = 'coc-prescreen';
export const NPC_ADVICE_TYPE = 'coc-npc-advice';
/** The single-loop run's own note to the Keeper (contract §135.8): the clerk's steps of this turn and what it asks. */
export const CLERK_TYPE = 'coc-clerk';
/**
 * Transport-only (contract §135.23): on the single-loop engine the turn's capsule stays as its first request sent it,
 * and what changed since then rides at the end of the request as this update, so the request's prefix only grows.
 */
export const CAPSULE_UPDATE_TYPE = 'coc-capsule-update';
export const CAPSULE_UPDATE_HEAD = 'The turn capsule above is this turn\'s start. These sections of it have changed since then, after this '
    + 'turn\'s own receipts: the values here are current and replace the ones above; every other section is unchanged.';
/** The capsule sections whose value differs from the turn's first capsule, or none. Structural: whole sections by key. */
export function capsuleUpdate(first: Row, current: Row): Row | undefined {
    const changed: Row = {}, removed: string[] = [];
    for (const [key, value] of Object.entries(current)) if (JSON.stringify(value) !== JSON.stringify(first[key])) changed[key] = value;
    for (const key of Object.keys(first)) if (!(key in current)) removed.push(key);
    if (!Object.keys(changed).length && !removed.length) return undefined;
    return {kind: 'capsule_update', head: CAPSULE_UPDATE_HEAD, sections: changed, ...(removed.length ? {removed} : {})};
}
export const POLICY_VERSION = 2;
export type Row = Record<string, any>;
export interface ContextBinding {
    version: number;
    campaign: string;
    worldline: string;
    loop: number;
    turn: number;
    source_revision: string | null;
    memory_coverage?: Row;
    unavailable?: boolean;
}
export interface Quote {
    turn: number;
    role: 'player' | 'keeper';
    text: string;
    total_chars: number;
    read: Row;
    verified: boolean;
}
export const sizeOf = (value: unknown): number => Buffer.byteLength(JSON.stringify(value), 'utf8');
/** Estimate model messages through the public Pi projection, excluding private tool metadata. */
export function requestSize(messages:readonly Row[]):number {
    const projected=convertToLlm(messages as unknown as Parameters<typeof convertToLlm>[0]);
    return sizeOf(projected.map(message=>{const {details: _private,...visible}=message as unknown as Row;return visible;}));
}
/** Read on each call. A positive integer of bytes; anything else falls back to the default. */
export function requestBudget(contextWindow?: number | null): number {
    const raw = process.env.PI_COC_REQUEST_BYTES?.trim();
    const configured = raw ? Number(raw) : Number.NaN;
    const base = Number.isSafeInteger(configured) && configured > 0 ? configured : REQUEST_BYTES;
    if (!Number.isSafeInteger(contextWindow ?? null) || Number(contextWindow) <= 0) return base;
    // A known window can only lower the budget, never raise it above what was configured.
    return Math.max(Math.min(base, HISTORY_BYTES), Math.min(base, Math.floor(Number(contextWindow) * BYTES_PER_TOKEN / 2)));
}
export function object(value: unknown): Row {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
}
export function bindingOf(value: unknown): ContextBinding | undefined {
    const data = object(value);
    if (data.version !== 1 || typeof data.campaign !== 'string' || typeof data.worldline !== 'string'
        || !Number.isSafeInteger(data.loop) || data.loop < 0 || !Number.isSafeInteger(data.turn) || data.turn < 0
        || !data.campaign || !data.worldline || typeof data.source_revision !== 'string' || !/^[a-f0-9]{64}$/.test(data.source_revision) || data.unavailable) return undefined;
    return data as ContextBinding;
}
export const epochOf = (binding: ContextBinding): string => JSON.stringify([binding.campaign, binding.worldline, binding.loop, binding.turn, binding.source_revision]);
export const sourceOf = (binding: ContextBinding): string => JSON.stringify([binding.campaign, binding.worldline, binding.loop, binding.source_revision]);
export function sameLine(left: ContextBinding, right: ContextBinding): boolean {
    return left.campaign === right.campaign && left.worldline === right.worldline && left.loop === right.loop;
}
export function metadata(binding: ContextBinding, unavailable?: string): Row {
    const coverage = structuredClone(binding.memory_coverage ?? {});
    const result: Row = {kind: 'historical_quotations', worldline: binding.worldline, loop: binding.loop, before_turn: binding.turn,
        authority: 'record_integrity_only',
        note: 'Historical quotations are recordings, not module truth. Partial wording is labeled; use its read reference for the retained original.',
        memory_coverage: coverage,
        ...(unavailable ? {history_unavailable: unavailable.slice(0, 200)} : {})};
    while (sizeOf(result) > HISTORY_METADATA_BYTES && Array.isArray(coverage.recent) && coverage.recent.length) {
        coverage.recent.shift(); coverage.truncated = true;
    }
    if (sizeOf(result) > HISTORY_METADATA_BYTES) {
        const count = (value: unknown): number | null => Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
        result.memory_coverage = {
            status: typeof coverage.status === 'string' && coverage.status.length <= 64 ? coverage.status : 'partial',
            committed: count(coverage.committed), completed: count(coverage.completed), gaps: count(coverage.gaps), truncated: true,
            note: 'Coverage detail was omitted; counts do not certify semantic completeness.',
        };
    }
    if (sizeOf(result) > HISTORY_METADATA_BYTES) {delete result.worldline; result.worldline_omitted = true;}
    if (sizeOf(result) > HISTORY_METADATA_BYTES) throw new Error('History metadata exceeded its byte budget');
    return result;
}
export function quoteView(quote: Quote, count = Array.from(quote.text).length): Row {
    const text = Array.from(quote.text).slice(0, count).join('');
    return {turn: quote.turn, role: quote.role, text, total_chars: quote.total_chars,
        range: {offset: 0, end: count}, truncated: count < quote.total_chars,
        verified: quote.verified, read: quote.read};
}
/** Prefer two recent complete pairs. Only explicit excerpts may stand in for an oversized pair. */
export function historyView(binding: ContextBinding, quotes: Quote[], unavailable?: string, budget = HISTORY_BYTES): Row {
    const base = metadata(binding, unavailable), selected: Row[] = [];
    const turns = [...new Set(quotes.map(quote => quote.turn))].sort((a, b) => b - a).slice(0, 2);
    const result = (): Row => ({...base, quotes: [...selected].sort((a, b) => a.turn - b.turn || (a.role === 'player' ? -1 : 1)),
        earlier_than: selected.length ? Math.min(...selected.map(quote => quote.turn)) : binding.turn});
    for (const turn of turns) {
        const group = quotes.filter(quote => quote.turn === turn).sort((a, b) => a.role === b.role ? 0 : a.role === 'player' ? -1 : 1).map(quote => quoteView(quote));
        selected.push(...group);
        if (sizeOf(result()) <= budget) continue;
        if (selected.length > group.length) {selected.splice(-group.length); break;}
        // The newest pair is too large. Reduce its longest original prefix; never silently drop a side.
        while (sizeOf(result()) > budget) {
            const longest = [...selected].sort((a, b) => sizeOf(b.text) - sizeOf(a.text))[0];
            const points = Array.from(longest.text as string);
            if (!points.length) {
                delete base.memory_coverage;
                if (sizeOf(result()) > budget) throw new Error('History metadata cannot fit its budget');
                break;
            }
            const excess = sizeOf(result()) - budget;
            let low = 0, high = points.length - 1;
            const originalBytes = sizeOf(longest.text);
            while (low < high) {
                const middle = Math.ceil((low + high) / 2);
                if (originalBytes - sizeOf(points.slice(0, middle).join('')) >= excess) low = middle;
                else high = middle - 1;
            }
            longest.text = points.slice(0, low).join('');
            longest.range.end = low;
            longest.truncated = low < longest.total_chars;
        }
        break;
    }
    const view = result();
    if (sizeOf(view) > budget) throw new Error('History exceeded its byte budget');
    return view;
}
export function briefForTurn(full: Row, capsule: Row): Row {
    const style: Row = {}, current = object(capsule.style);
    for (const [key, value] of Object.entries(object(full.style))) {
        if (Array.isArray(value) && Array.isArray(current[key])) {
            const present = new Set(current[key].map((entry: unknown) => JSON.stringify(entry)));
            const extra = value.filter(entry => !present.has(JSON.stringify(entry)));
            if (extra.length) style[key] = extra;
        } else if (JSON.stringify(value) !== JSON.stringify(current[key])) style[key] = value;
    }
    const result = {...full};
    if (Object.keys(style).length) result.style = style;
    else delete result.style;
    return result;
}
export function customMessage(customType: string, content: Row | string, timestamp = 0): Row {
    return {role: 'custom', customType, content: typeof content === 'string' ? content : JSON.stringify(content), display: false, timestamp};
}
function messageBinding(message: Row): ContextBinding | undefined {
    return bindingOf(object(message.details).context);
}
/** In-memory message timestamps are not session-entry timestamps. Match structural capsule bindings. */
export function currentStart(messages: Row[], binding: ContextBinding): number {
    let capsule = -1;
    for (let index = messages.length - 1; index >= 0; index--) {
        const message = messages[index], actual = messageBinding(message);
        if (message.role === 'custom' && message.customType === 'coc-capsule' && actual && sameLine(actual, binding) && actual.turn === binding.turn) {
            capsule = index; break;
        }
    }
    if (capsule < 0) return -1;
    for (let index = capsule - 1; index >= 0; index--) if (messages[index].role === 'user') return index;
    return 0;
}
function olderAskStart(messages: Row[], start: number, binding: ContextBinding): number {
    for (let index = start - 1; index >= 0; index--) {
        const previous = messageBinding(messages[index]);
        if (messages[index].customType !== 'coc-capsule' || !previous || !sameLine(previous, binding)) continue;
        for (let user = index - 1; user >= 0; user--) if (messages[user].role === 'user') return user;
        return 0;
    }
    return start;
}
const LEGACY_TURN_NOTES = new Set(['opening', 'recovery', 'steer', 'floor', 'player-input-failed', 'reading-wait']);
// Called only before a proven current boundary. Turn ordinals cannot order different worldlines.
function closedNoise(message: Row): boolean {
    if (['user', 'assistant', 'toolResult', 'compactionSummary'].includes(message.role)) return true;
    if (message.role !== 'custom') return false;
    // A coc-workspace from an older binding is regenerated for the current request or omitted;
    // keeping one would let stale evidence ride every later turn as unclassified material.
    if (['coc-capsule', HISTORY_TYPE, BRIEF_TYPE, DIAGNOSTIC_TYPE, WORKSPACE_TYPE, PRESCREEN_TYPE, NPC_ADVICE_TYPE, CLERK_TYPE, CAPSULE_UPDATE_TYPE].includes(message.customType)) return true;
    const details = object(message.details);
    if (message.customType === 'coc-delivery' && details.coc_delivery === true && Number.isSafeInteger(details.turn)) return true;
    return message.customType === 'coc-host' && (details.kind === 'compacted'
        || details.scope === 'turn' && details.coc_host === true && typeof details.campaign === 'string' && Number.isSafeInteger(details.turn)
        || details.scope == null && LEGACY_TURN_NOTES.has(details.kind));
}
export interface Projection {
    messages: Row[]; start: number; protectedBytes: number; unknownBytes: number;
    degraded?: string; droppedTail?: number; droppedUnknown?: number; overCeiling?: boolean; workspaceKept?: boolean; prescreenKept?: boolean;
    npcKept?: boolean;
}
/**
 * The one request projection, and the one place the ceiling is enforced. Every exit fits
 * `budget`: a boundary this policy cannot read is a reason to fall back to a bounded tail,
 * never a reason to hand the provider the whole stored branch.
 */
export function projectedMessages(input: {
    messages: Row[]; binding: ContextBinding; history: Row; brief?: Row; answering?: string[]; budget?: number;
    workspace?: Row; prescreen?: Row; npc?:Row;
}): Projection {
    const {messages, binding} = input, budget = input.budget ?? requestBudget();
    const fallback = (degraded: string): Projection => {
        const cut = boundedTail(messages, budget);
        return {messages: cut.messages, start: -1, protectedBytes: requestSize(cut.messages), unknownBytes: 0,
            degraded, ...(cut.dropped ? {droppedTail: cut.dropped} : {}), ...(cut.over ? {overCeiling: true} : {})};
    };
    let start = currentStart(messages, binding);
    if (start < 0) return fallback('current_boundary_unavailable');
    if (input.answering?.length) start = olderAskStart(messages, start, binding);
    let unknown: Row[] = [];
    for (const message of messages.slice(0, start)) if (!closedNoise(message)) unknown.push(message);
    const tail = messages.slice(start);
    // Full static package/book context is carried once, outside the rolling history allocation.
    const brief = input.brief ? [customMessage(BRIEF_TYPE, input.brief)] : [];
    const history = customMessage(HISTORY_TYPE, input.history);
    if (!pairedTools([...unknown, ...brief, history, ...tail])) return fallback('tool_pair_unavailable');
    // The player's own words and this turn's capsule are never compressible; only the tool traffic
    // the turn has since accumulated is, and the kernel stays authoritative for what it drops.
    const capsule = tail.findIndex(message => message.role === 'custom' && message.customType === 'coc-capsule');
    const opening = tail.slice(0, capsule < 0 ? 1 : capsule + 1), working = tail.slice(opening.length);
    // Retained pre-boundary material is unclassified, not authoritative: the ceiling takes it first.
    let droppedUnknown = 0;
    const fixed = (extra: Row[]): Row[] => [...unknown, ...brief, history, ...opening, ...extra];
    const room = (extra: Row[]): number => Math.max(0, budget - requestSize(fixed(extra)));
    while (unknown.length && requestSize(unknown) > Math.min(UNCLASSIFIED_BYTES, budget)) {unknown = unknown.slice(1); droppedUnknown++;}
    let cut = boundedTail(working, room([]));
    // The optional workspace joins only when it displaces no current material: if this turn's own
    // traffic is already being cut, or would have to be cut to fit it, the workspace is omitted.
    // Current capsule, the player's words, pending context, tool pairing and the ceiling all
    // precede it (contract §19.2); a missing workspace is a miss, never a degraded request.
    const optional: Row[] = [];
    let workspaceKept = false, prescreenKept = false, npcKept=false;
    // Preselection may have excluded bodies supplied by the workspace. Reserve that dependency
    // first, so adding the supplement never removes evidence the ordinary request would retain.
    for (const [kind, message] of [['workspace', input.workspace], ['prescreen', input.prescreen], ['npc',input.npc]] as const) {
        if (!message || cut.over || cut.dropped) continue;
        const widened = boundedTail(working, room([...optional, message]));
        if (!widened.over && !widened.dropped) {
            cut = widened; optional.push(message);
            if (kind === 'prescreen') prescreenKept = true; else if(kind==='npc')npcKept=true;else workspaceKept = true;
        }
    }
    while (unknown.length && cut.over) {unknown = unknown.slice(1); droppedUnknown++; cut = boundedTail(working, room(optional));}
    const projected = [...fixed(optional), ...cut.messages];
    const over = cut.over || requestSize(projected) > budget;
    return {messages: projected, start, ...(workspaceKept ? {workspaceKept} : {}), ...(prescreenKept ? {prescreenKept} : {}), ...(npcKept?{npcKept}:{}),
        protectedBytes: requestSize(opening) + requestSize(cut.messages) + (brief.length ? requestSize(brief) : 0), unknownBytes: unknown.length ? requestSize(unknown) : 0,
        ...(cut.dropped ? {droppedTail: cut.dropped} : {}), ...(droppedUnknown ? {droppedUnknown} : {}),
        ...(over ? {overCeiling: true} : {}),
        ...(unknown.length ? {degraded: 'unclassified_messages_retained'}
            : cut.dropped || droppedUnknown ? {degraded: 'request_ceiling_reached'} : {})};
}
/**
 * Every suffix cut that keeps tool pairing. `safe[c]` means `messages.slice(c)` is pair-safe,
 * so the ceiling can drop the oldest messages without orphaning a tool result.
 */
export function safeCutPoints(messages: Row[]): boolean[] {
    const safe = new Array<boolean>(messages.length + 1).fill(true), callAt = new Map<string, number>();
    for (let index = 0; index < messages.length; index++) {
        const message = messages[index];
        if (message.role === 'assistant' && Array.isArray(message.content))
            for (const block of message.content) if (block.type === 'toolCall' && typeof block.id === 'string') callAt.set(block.id, index);
        if (message.role !== 'toolResult') continue;
        const call = callAt.get(message.toolCallId);
        // A result whose call is already absent can never be retained; no cut at or before it is safe.
        for (let cut = call === undefined ? 0 : call + 1; cut <= index; cut++) safe[cut] = false;
    }
    return safe;
}
/**
 * The largest pair-safe suffix that fits `budget`, oldest messages given up first. An empty
 * suffix is a valid answer of last resort: what it drops is this turn's own intermediate tool
 * traffic, which the kernel can still serve, and an unbounded request is the worse outcome.
 */
export function boundedTail(messages: Row[], budget: number): {messages: Row[]; dropped: number; over: boolean} {
    const safe = safeCutPoints(messages);
    for (let cut = 0; cut <= messages.length; cut++)
        if (safe[cut] && requestSize(messages.slice(cut)) <= budget) return {messages: messages.slice(cut), dropped: cut, over: false};
    // Only reachable when the budget cannot hold even an empty list; say so instead of pretending.
    return {messages: [], dropped: messages.length, over: true};
}
/** A cut is safe only if every retained tool result has a retained call. */
export function pairedTools(messages: Row[]): boolean {
    const calls = new Set<string>();
    for (const message of messages) {
        if (message.role === 'assistant' && Array.isArray(message.content))
            for (const block of message.content) if (block.type === 'toolCall' && typeof block.id === 'string') calls.add(block.id);
        if (message.role === 'toolResult' && !calls.has(message.toolCallId)) return false;
    }
    return true;
}
export function entryMessage(entry: Row): Row | undefined {
    if (entry.type === 'message') return entry.message;
    if (entry.type === 'custom_message') return {role: 'custom', customType: entry.customType, content: entry.content, details: entry.details, timestamp: 0};
    return undefined;
}
/**
 * Folded-away messages this policy cannot classify. The fold hook takes one cut point and no
 * exception list, so their own text rides in the summary; nothing is dropped without a record.
 */
export function carriedUnclassified(older: Row[], previous?: Row): Row | undefined {
    const unknown = older.filter(message => !closedNoise(message));
    const retained = Array.isArray(previous?.entries) ? previous.entries
        .filter((entry: Row) => typeof entry?.customType === 'string' && typeof entry?.text === 'string')
        .map((entry: Row) => ({customType: entry.customType, text: entry.text})) : [];
    const count = Number.isSafeInteger(previous?.count) && previous!.count >= retained.length ? previous!.count : retained.length;
    if (!unknown.length && !count) return undefined;
    const text = (message: Row): string => typeof message.content === 'string' ? message.content
        : Array.isArray(message.content) ? message.content.filter((block: Row) => typeof block?.text === 'string').map((block: Row) => block.text).join('\n') : '';
    const result: Row = {count: count + unknown.length, note: 'Host notices folded with the older turns; recordings, not module truth.',
        entries: [...retained, ...unknown.map(message => ({customType: message.customType ?? message.role, text: text(message)}))],
        ...(previous?.truncated === true ? {truncated: true} : {})};
    while (sizeOf(result) > UNCLASSIFIED_BYTES && Array.isArray(result.entries) && result.entries.length) {
        result.entries.shift(); result.truncated = true;
    }
    return result;
}
/** Safe single-cut storage adapter; the outbound adapter remains authoritative for request size. */
export function foldPlan(entries: Row[], binding: ContextBinding, history: Row, answering?: string[]): Row | undefined {
    // Pi owns branch-local edits and compaction selection. Keep raw provenance for the cut,
    // but never read omitted or replaced content back from those source entries. Pi carries
    // system prompts and tools in its own compaction checkpoint, not historical quotations.
    const indices = new Map(entries.map((entry, index) => [entry.id, index]));
    const projection = buildSessionProjection(entries as SessionEntry[]);
    const checkpoint = projection.entries.find(({sourceEntry, messages}) => sourceEntry.type === 'compaction'
        && messages.some(message => message.role === 'compactionSummary'));
    const previous = checkpoint?.sourceEntry as Row | undefined;
    const previousSummary = checkpoint?.messages.find(message => message.role === 'compactionSummary');
    const priorFold = object(previous?.details).coc_fold?.version === POLICY_VERSION;
    let retained: Row | undefined;
    if (priorFold && previousSummary?.role === 'compactionSummary') {
        try {retained = object(JSON.parse(previousSummary.summary)).retained_unclassified;}
        catch { /* An unreadable checkpoint cannot supply carried notices. */ }
    }
    const records = projection.entries.flatMap(({sourceEntry: entry, messages}) =>
        entry.type === 'message' || entry.type === 'custom_message'
            ? messages.filter(message => message.role !== 'system')
                .map(message => ({entry, index: indices.get(entry.id)!, message: message as Row})) : []);
    const messages = records.map(record => record.message);
    let start = currentStart(messages, binding);
    if (start >= 0 && answering?.length) start = olderAskStart(messages, start, binding);
    if (start < 0) {
        // before_agent_start has not appended its new input yet: keep the latest complete user group.
        for (let index = messages.length - 1; index >= 0; index--) if (messages[index].role === 'user') {start = index; break;}
    }
    if (start < 0 || !pairedTools(messages.slice(start))) return undefined;
    const kept = records[start];
    if (!kept?.entry.id) return undefined;
    // An entry this policy does not recognise is carried into the summary, not left as a permanent
    // veto on every future cut: one unclassified message at the head used to pin the whole branch.
    const carried = carriedUnclassified(messages.slice(0, start), retained);
    const summary = carried ? {...history, retained_unclassified: carried} : history;
    const serialized = JSON.stringify(summary);
    // A protected group at zero cannot be folded again. Return only the identical prior plan
    // so the runtime's persisted plan_key check reports no_progress instead of no_safe_cut.
    if (start === 0 && (!priorFold || previous?.firstKeptEntryId !== kept.entry.id || previous.summary !== serialized)) return undefined;
    return {summary: serialized, firstKeptEntryId: kept.entry.id,
        details: {coc_fold: {version: POLICY_VERSION, source: {campaign: binding.campaign, worldline: binding.worldline, loop: binding.loop, turn: binding.turn},
            retained_from: kept.entry.id, history_bytes: sizeOf(summary), earlier_than: history.earlier_than,
            ...(carried ? {unclassified: carried.count} : {})}},
        folded: start === 0 ? 0 : kept.index};
}
