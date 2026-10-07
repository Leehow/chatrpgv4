/**
 * Contract §191.5: the shape of the independent identity reviewer's answer about two published nodes -- each pair answered
 * once, `same` or `different`, with the reason the pages gave. Whether two nodes are one thing is the reviewer's answer,
 * never this file's.
 *
 * Import-free on purpose: the host's reviewer (`extensions/module/node-identity-review.ts`) checks the answer before it goes
 * to the kernel, the kernel's finish (`identity-repair.ts`) checks it again, and the host loads this file directly.
 */
type Row = Record<string, any>;

/** The answer file's protocol: what the host's reviewer writes and the finish reads. */
export const NODE_IDENTITY_PROTOCOL = 'node-identity-v1';
/** A verdict's reason is kept to this many characters. */
export const NODE_IDENTITY_REASON_CHARS = 500;
const VERDICTS = ['same', 'different'];

/** One answer of an identity job's reader. */
export interface NodeVerdict { key: string; verdict: 'same' | 'different'; reason: string }

const object = (value: unknown): value is Row => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The reader's answers (`{verdicts: [{key, verdict, reason}]}`) to `pairs`: each verdict names a pair once, says `same` or
 * `different`, and gives its reason. `complete`: every pair is answered and no other. Throws an Error naming the slip.
 */
export function nodeIdentityVerdicts(value: unknown, pairs: readonly Row[], options: { complete?: boolean } = {}): NodeVerdict[] {
    if (!object(value) || !Array.isArray(value.verdicts)) throw new Error('an identity answer is an object with a verdicts array');
    const keys = new Set(pairs.map(pair => String(pair.key))), seen = new Set<string>(), out: NodeVerdict[] = [];
    for (const [index, entry] of (value.verdicts as unknown[]).entries()) {
        const at = `verdicts[${index}]`;
        if (!object(entry) || typeof entry.key !== 'string' || !entry.key) throw new Error(`${at} needs the key of the pair it answers`);
        if (seen.has(entry.key)) throw new Error(`${at} answers pair ${entry.key} a second time`);
        seen.add(entry.key);
        if (!VERDICTS.includes(entry.verdict)) throw new Error(`${at}.verdict must be one of ${VERDICTS.join(', ')}`);
        if (typeof entry.reason !== 'string' || !entry.reason.trim()) throw new Error(`${at}.reason must say what on the pages decided it`);
        if (!keys.has(entry.key)) {
            if (options.complete) throw new Error(`${at} answers a pair that was not asked`);
            continue;
        }
        out.push({ key: entry.key, verdict: entry.verdict, reason: Array.from(entry.reason.trim()).slice(0, NODE_IDENTITY_REASON_CHARS).join('') });
    }
    if (options.complete) {
        const missing = [...keys].filter(key => !seen.has(key));
        if (missing.length) throw new Error(`answer every pair; no verdict for ${missing.join(', ')}`);
    }
    return out;
}
