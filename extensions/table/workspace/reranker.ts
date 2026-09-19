import {createHash} from 'node:crypto';
// @ts-ignore The optional rerank agent is a JavaScript extension with its own runtime contract.
import {rerank as rerankClient} from '../../rerank/agent/index.js';
import type {Row} from '../context-policy.ts';

export const RERANK_CANDIDATE_LIMIT = 48;
export const RERANK_MIN_CANDIDATES = 2;
export const RERANK_TIMEOUT_MS = 500;
const RANK_CACHE_LIMIT = 128;
const RANK_INPUT_BYTES = 48 * 1024;
const RANK_DOCUMENT_BYTES = 2 * 1024;

type RankRow = {index: number; score: number};
type RankResult = {provider?: string; model?: string; results?: RankRow[]};
export type RankClient = (query: string, documents: string[], options: {signal: AbortSignal; topN: number}) => Promise<RankResult>;
export type RankOutcome =
    | {status: 'skipped'; reason: string}
    | {status: 'ranked' | 'cache'; order: string[]; provider?: string; model?: string; candidates: number; ms: number}
    | {status: 'fallback'; reason: string; order: string[]; candidates: number; ms: number};

const cache = new Map<string, {order: string[]; provider?: string; model?: string}>();
const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const text = (value: unknown): string => {
    if (typeof value !== 'string') return '';
    let result = '', bytes = 0;
    for (const char of value.trim()) {const count = Buffer.byteLength(char, 'utf8'); if (bytes + count > RANK_DOCUMENT_BYTES) break; result += char; bytes += count;}
    return result;
};
const defaultRanker: RankClient = (query, documents, options) => rerankClient(query, documents, {topN: options.topN, signal: options.signal});

function remember(key: string, value: {order: string[]; provider?: string; model?: string}): void {
    cache.delete(key);
    cache.set(key, value);
    while (cache.size > RANK_CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
}

/**
 * Rank host-only candidate text before the public workspace cut. Errors never block a request:
 * deterministic order is returned, and no score is exposed in `coc-workspace`.
 */
export async function rankWorkspaceCandidates(input: {
    query: string;
    candidates: readonly Row[];
    signal?: AbortSignal;
    ranker?: RankClient;
    maxCandidates?: number;
    timeoutMs?: number;
    binding?: unknown;
}): Promise<RankOutcome> {
    const query = input.query.trim();
    // Keep the player's query intact. If it alone cannot fit, skip optional ranking instead
    // of truncating the declaration or sending a request beyond the input ceiling.
    const queryBytes = Buffer.byteLength(JSON.stringify({query, documents: []}), 'utf8') + 1024;
    if (queryBytes > RANK_INPUT_BYTES) return {status: 'skipped', reason: 'query_over_budget'};
    const limit = Math.min(Math.max(1, input.maxCandidates ?? RERANK_CANDIDATE_LIMIT), RERANK_CANDIDATE_LIMIT);
    let bytes = queryBytes;
    const pool = input.candidates.slice(0, 128).map(candidate => ({locator: typeof candidate.locator === 'string' ? candidate.locator : '', body: text(candidate.text)}))
        .filter(candidate => candidate.locator && candidate.body)
        .filter((candidate, index, all) => all.findIndex(other => other.locator === candidate.locator) === index)
        .slice(0, limit).filter(candidate => {
            const count = Buffer.byteLength(JSON.stringify(candidate), 'utf8');
            if (bytes + count > RANK_INPUT_BYTES) return false; bytes += count; return true;
        });
    const fallback = (reason: string, began: number): RankOutcome => ({status: 'fallback', reason, candidates: pool.length,
        order: pool.map(candidate => candidate.locator), ms: Date.now() - began});
    if (!query) return {status: 'skipped', reason: 'empty_query'};
    if (input.signal?.aborted) return {status: 'skipped', reason: 'cancelled'};
    if (pool.length < RERANK_MIN_CANDIDATES) return {status: 'skipped', reason: 'too_few_candidates'};
    const key = digest({query, pool, binding: input.binding, adapter: 'workspace-rank-v2', settings: process.env.PIPIUI_EXT_SETTINGS_RERANK ?? ''});
    const hit = cache.get(key);
    if (hit) {
        cache.delete(key); cache.set(key, hit);
        return {status: 'cache', order: [...hit.order], provider: hit.provider, model: hit.model,
            candidates: pool.length, ms: 0};
    }
    const began = Date.now(), controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new DOMException('rerank deadline exceeded', 'AbortError')), input.timeoutMs ?? RERANK_TIMEOUT_MS);
    const signal = input.signal ? AbortSignal.any([input.signal, controller.signal]) : controller.signal;
    let abort: (() => void) | undefined;
    try {
        const cancelled = new Promise<never>((_, reject) => {
            abort = () => reject(new DOMException('rerank cancelled', 'AbortError'));
            signal.addEventListener('abort', abort, {once: true});
            if (signal.aborted) abort();
        });
        const result = await Promise.race([
            (input.ranker ?? defaultRanker)(query, pool.map(candidate => candidate.body), {signal, topN: pool.length}), cancelled,
        ]);
        if (signal.aborted) return fallback('cancelled', began);
        const rows = Array.isArray(result?.results) ? result.results : [];
        const seen = new Set<number>(), order: string[] = [];
        for (const row of rows) {
            if (!row || !Number.isSafeInteger(row.index) || row.index < 0 || row.index >= pool.length
                || !Number.isFinite(row.score) || seen.has(row.index)) return fallback('invalid_result', began);
            seen.add(row.index); order.push(pool[row.index].locator);
        }
        if (!order.length) return fallback('empty_result', began);
        for (let index = 0; index < pool.length; index++) if (!seen.has(index)) order.push(pool[index].locator);
        const value = {order, provider: typeof result.provider === 'string' ? result.provider : undefined,
            model: typeof result.model === 'string' ? result.model : undefined};
        remember(key, value);
        return {status: 'ranked', ...value, candidates: pool.length, ms: Date.now() - began};
    } catch (error) {
        return fallback(error instanceof Error && error.name === 'AbortError' ? 'timeout' : 'unavailable', began);
    } finally { clearTimeout(timer); if (abort) signal.removeEventListener('abort', abort); }
}

export function clearRankCache(): void { cache.clear(); }
