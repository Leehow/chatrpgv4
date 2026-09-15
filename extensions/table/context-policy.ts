/** One deterministic policy for request-local history and persisted COC folds. */
export const HISTORY_BYTES = 32 * 1024;
export const HISTORY_METADATA_BYTES = 4096;
export const HISTORY_TYPE = 'coc-history';
export const BRIEF_TYPE = 'coc-context-brief';
export const DIAGNOSTIC_TYPE = 'coc-context-status';
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
    if (['coc-capsule', HISTORY_TYPE, BRIEF_TYPE, DIAGNOSTIC_TYPE].includes(message.customType)) return true;
    const details = object(message.details);
    if (message.customType === 'coc-delivery' && details.coc_delivery === true && Number.isSafeInteger(details.turn)) return true;
    return message.customType === 'coc-host' && (details.kind === 'compacted'
        || details.scope === 'turn' && details.coc_host === true && typeof details.campaign === 'string' && Number.isSafeInteger(details.turn)
        || details.scope == null && LEGACY_TURN_NOTES.has(details.kind));
}
export function projectedMessages(input: {
    messages: Row[]; binding: ContextBinding; history: Row; brief?: Row; answering?: string[];
}): {messages: Row[]; start: number; protectedBytes: number; unknownBytes: number; degraded?: string} {
    const {messages, binding} = input;
    let start = currentStart(messages, binding);
    if (start < 0) return {messages, start, protectedBytes: sizeOf(messages), unknownBytes: 0, degraded: 'current_boundary_unavailable'};
    if (input.answering?.length) start = olderAskStart(messages, start, binding);
    const unknown: Row[] = [];
    for (const message of messages.slice(0, start)) if (!closedNoise(message)) unknown.push(message);
    const tail = messages.slice(start);
    // Full static package/book context is carried once, outside the rolling history allocation.
    const brief = input.brief ? [customMessage(BRIEF_TYPE, input.brief)] : [];
    const history = customMessage(HISTORY_TYPE, input.history);
    const projected = [...unknown, ...brief, history, ...tail];
    if (!pairedTools(projected)) return {messages, start, protectedBytes: sizeOf(messages), unknownBytes: unknown.length ? sizeOf(unknown) : 0, degraded: 'tool_pair_unavailable'};
    return {messages: projected, start,
        protectedBytes: sizeOf(tail) + (brief.length ? sizeOf(brief) : 0), unknownBytes: unknown.length ? sizeOf(unknown) : 0,
        ...(unknown.length ? {degraded: 'unclassified_messages_retained'} : {})};
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
/** Safe single-cut storage adapter; the outbound adapter remains authoritative for request size. */
export function foldPlan(entries: Row[], binding: ContextBinding, history: Row, answering?: string[]): Row | undefined {
    const records = entries.map((entry, index) => ({entry, index, message: entryMessage(entry)})).filter(record => record.message);
    const messages = records.map(record => record.message!);
    let start = currentStart(messages, binding);
    if (start >= 0 && answering?.length) start = olderAskStart(messages, start, binding);
    if (start < 0) {
        // before_agent_start has not appended its new input yet: keep the latest complete user group.
        for (let index = messages.length - 1; index >= 0; index--) if (messages[index].role === 'user') {start = index; break;}
    }
    if (start > 0) {
        const unknown = messages.slice(0, start).findIndex(message => !closedNoise(message));
        if (unknown >= 0) start = unknown;
    }
    if (start <= 0 || !pairedTools(messages.slice(start))) return undefined;
    const kept = records[start];
    if (!kept?.entry.id) return undefined;
    return {summary: JSON.stringify(history), firstKeptEntryId: kept.entry.id,
        details: {coc_fold: {version: POLICY_VERSION, source: {campaign: binding.campaign, worldline: binding.worldline, loop: binding.loop, turn: binding.turn},
            retained_from: kept.entry.id, history_bytes: sizeOf(history), earlier_than: history.earlier_than}},
        folded: kept.index};
}
