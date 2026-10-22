/** Request-local fold of this turn's already-read results; the session keeps every original result. */
type Row = Record<string, any>;
/**
 * Read-only tools whose result the Keeper has already reasoned over by the time a later batch exists. `mod` sections and
 * capability lookups are disclosed detail the turn's ledger counts as delivered, so they are never folded.
 */
const READS = new Set(['look', 'lookup', 'recall', 'place']);
const HEAD = 600, MIN = 1500;
const textOf = (message: Row): string => Array.isArray(message.content)
    ? message.content.map((block: Row) => block.type === 'text' ? String(block.text ?? '') : '').join('\n') : String(message.content ?? '');
const foldable = (message: Row, calls: Map<string, Row>): boolean => {
    const args = calls.get(message.toolCallId)?.arguments ?? {};
    if (message.toolName === 'place') return args.action === 'inspect';
    return !(message.toolName === 'lookup' && args.kind === 'capability');
};
const signatureOf = (message: Row, calls: Map<string, Row>): string =>
    JSON.stringify([message.toolName, calls.get(message.toolCallId)?.arguments ?? null]);

/**
 * Folds the current input's read results that precede its latest tool batch, oldest first, until `need` bytes are
 * freed. Results named in `sticky` (folded by an earlier request of the input) are folded first whatever `need` is,
 * so later requests keep the same prefix. A read repeated after its first result was folded (its signature is in
 * `refolded`) is one the Keeper still needs and is never folded again. A folded result keeps its toolCallId (pairing
 * stays valid) and the head of its text; the latest batch, every write result and every result before this input's
 * player message are never touched.
 */
export function foldConsumedReads(messages: readonly Row[], need: number, size: (list: Row[]) => number,
    sticky: ReadonlySet<string> = new Set(), refolded: ReadonlySet<string> = new Set()):
    {messages: Row[]; folded: {tool: string; id: string; signature: string; bytes: number}[]} {
    const out = [...messages], folded: {tool: string; id: string; signature: string; bytes: number}[] = [];
    if (need <= 0 && !sticky.size) return {messages: out, folded};
    const start = out.findLastIndex(message => message.role === 'user');
    const latest = out.findLastIndex(message => message.role === 'assistant' && Array.isArray(message.content)
        && message.content.some((block: Row) => block.type === 'toolCall'));
    if (start < 0 || latest <= start) return {messages: out, folded};
    const calls = new Map<string, Row>();
    for (const message of out.slice(start, latest)) if (message.role === 'assistant' && Array.isArray(message.content))
        for (const block of message.content) if (block.type === 'toolCall') calls.set(block.id, block);
    let freed = 0;
    for (const pass of [true, false]) for (let index = start + 1; index < latest; index++) {
        const message = out[index];
        if (message.role !== 'toolResult' || !READS.has(message.toolName) || !foldable(message, calls)) continue;
        if (pass ? !sticky.has(message.toolCallId) : freed >= need || sticky.has(message.toolCallId)) continue;
        const signature = signatureOf(message, calls);
        if (!pass && refolded.has(signature)) continue;
        const text = textOf(message);
        if (Buffer.byteLength(text) < MIN) continue;
        const stub = {...message, content: [{type: 'text', text: JSON.stringify({folded_read: true, tool: message.toolName,
            note: 'This read result was returned earlier in this turn and is folded to keep room; you have already read it. Its head is kept. Repeat the read only if a decision still depends on the rest; a repeated read stays whole.',
            head: text.slice(0, HEAD)})}]};
        const before = size([message]), after = size([stub]);
        if (after >= before) continue;
        out[index] = stub; freed += before - after;
        folded.push({tool: String(message.toolName), id: String(message.toolCallId), signature, bytes: before - after});
    }
    return {messages: out, folded};
}
