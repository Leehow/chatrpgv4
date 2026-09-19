import {createHash} from 'node:crypto';
// @ts-ignore The optional rerank agent is a JavaScript extension with its own runtime contract.
import {rerank as rerankClient} from '../../rerank/agent/index.js';
import type {Row} from '../context-policy.ts';

export const RERANK_CANDIDATE_LIMIT = 48;
export const RERANK_MIN_CANDIDATES = 9;
export const RERANK_TIMEOUT_MS = 500;
const RANK_CACHE_LIMIT = 128;

type RankRow = {index: number; score: number};
type RankResult = {provider?: string; model?: string; results?: RankRow[]};
export type RankClient = (query: string, documents: string[], options: {signal: AbortSignal; topN: number}) => Promise<RankResult>;
export type RankOutcome =
    | {status: 'skipped'; reason: string}
    | {status: 'ranked' | 'cache'; order: string[]; provider?: string; model?: string; candidates: number; ms: number}
    | {status: 'fallback'; reason: string; order: string[]; candidates: number; ms: number};

const cache = new Map<string, {order: string[]; provider?: string; model?: string}>();
const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const text = (value: unknown): string => typeof value === 'string' ? value.trim().slice(0, 2000) : '';
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
}): Promise<RankOutcome> {
    const query = input.query.trim();
    const limit = Math.min(Math.max(1, input.maxCandidates ?? RERANK_CANDIDATE_LIMIT), RERANK_CANDIDATE_LIMIT);
    const pool = input.candidates.map(candidate => ({locator: text(candidate.locator), body: text(candidate.text)}))
        .filter(candidate => candidate.locator && candidate.body)
        .filter((candidate, index, all) => all.findIndex(other => other.locator === candidate.locator) === index)
        .slice(0, limit);
    const fallback = (reason: string, began: number): RankOutcome => ({status: 'fallback', reason, candidates: pool.length,
        order: pool.map(candidate => candidate.locator), ms: Date.now() - began});
    if (!query) return {status: 'skipped', reason: 'empty_query'};
    if (pool.length < RERANK_MIN_CANDIDATES) return {status: 'skipped', reason: 'too_few_candidates'};
    const key = digest({query, pool, settings: process.env.PIPIUI_EXT_SETTINGS_RERANK ?? ''});
    const hit = cache.get(key);
    if (hit) {
        cache.delete(key); cache.set(key, hit);
        return {status: 'cache', order: [...hit.order], provider: hit.provider, model: hit.model,
            candidates: pool.length, ms: 0};
    }
    const began = Date.now(), controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('rerank deadline exceeded')), input.timeoutMs ?? RERANK_TIMEOUT_MS);
    const signal = input.signal ? AbortSignal.any([input.signal, controller.signal]) : controller.signal;
    try {
        const result = await (input.ranker ?? defaultRanker)(query, pool.map(candidate => candidate.body), {signal, topN: pool.length});
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
    } finally { clearTimeout(timer); }
}

export function clearRankCache(): void { cache.clear(); }
