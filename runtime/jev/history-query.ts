/**
 * Contract §124.12 (owner, 2026-10-02: the fast model writes it, once per scene): the English search query for a scene's historical lookup.
 *
 * The host's fixed-shape query carries the authored fields as written, so a Chinese-authored 1975 West Texas table
 * searched in Chinese and got Chinese pages back: present-day travel guides and a translated novel. Sources about that
 * time and place are English. One zero-tool completion on the fast model (`runLane`: this lane's variable, then the
 * fast-model setting, then the table) reads the authored era, place and scene and writes one English query and
 * objective naming the real period, region and kind of place. It runs once per scene -- the engine keeps each scene's
 * result -- and beside the run's other steps. `write` never throws: any failure is `{ok: false}` with a closed reason,
 * and the caller searches with the fixed-shape query instead.
 */
import type {ExtensionAPI, ExtensionContext} from '@earendil-works/pi-coding-agent';
import {runLane} from '../../extensions/lanes/subsession.ts';
import {createLaneTelemetry} from '../../extensions/lanes/telemetry.ts';

/** The lane's name on every row it writes. */
export const HISTORY_QUERY_LANE = 'history-query';
/** The operator's variable naming this lane's model (then the fast-model setting, then the table). */
export const HISTORY_QUERY_MODEL_ENV = 'PI_COC_HISTORY_QUERY_MODEL';
/** One round; past it the caller searches with the fixed-shape query. */
export const HISTORY_QUERY_TIMEOUT_MS = 6000;
/** The search accepts at most these lengths (`HistoricalReference.search`: query 2048, objective 512). */
export const HISTORY_QUERY_MAX = 300, HISTORY_OBJECTIVE_MAX = 512;

export const HISTORY_QUERY_INSTRUCTION = [
  'You write one web search for historical background to a scene of a tabletop horror game.',
  'The input JSON holds what the scenario\'s authors wrote, in whatever language they wrote it: era, scene (the place\'s name and what it is), background.',
  'Answer with one JSON object and nothing else: {"query": "...", "objective": "..."}, both in English.',
  'query: at most 300 characters. Aim it at written accounts of that time and place, which describe what a place was like: first-hand accounts, memoirs, oral histories, newspaper or magazine features, travel writing. Name the decade, the real region and the kind of place, and put words for such writing in it, e.g. "1970s rural West Texas country store first-hand account". Do not aim it at photographs, postcards or archive catalogues: they hold almost no description. Leave out the scenario\'s invented names of people and businesses; a real town, region or institution may stay.',
  'objective: at most 480 characters. Say which details of that time and place the scene needs (appearance, goods, the regulars, how people worked and talked there) and ask for writing that shows how it was then: period newspapers and magazines, memoirs, oral histories, travel writing. Rule out present-day travel guides, listings, opening hours, museum notes and photo catalogues. Do not ask for prices.',
  'When the setting is fictional, name the real period and culture it borrows from instead.',
].join('\n');

export type HistoryQueryFailure = 'no_session' | 'cancelled' | 'timeout' | 'model_unavailable' | 'model_error' | 'bad_output' | 'lane_error';
export type HistoryQueryResult = {ok: true; query: string; objective: string; ms: number; model?: string}
  | {ok: false; reason: HistoryQueryFailure; detail: string; ms: number; model?: string};
export interface HistoryQueryFacts {era: string; place: string; summary?: string; background?: string}
export interface HistoryQueryPort {write(facts: HistoryQueryFacts, signal: AbortSignal): Promise<HistoryQueryResult>}

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

/**
 * The closed shape: two nonempty strings, cut at a code point to the search's bounds. Their wording is the model's.
 * An over-long answer is cut, not refused: on the installed App (2026-10-02) the first answer after the instruction
 * asked for a fuller objective was refused whole and the scene searched the authored Chinese wording instead.
 */
export function checkHistoryQuery(parsed: unknown): {query: string; objective: string} | undefined {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
  const query = clip(text((parsed as Record<string, unknown>).query), HISTORY_QUERY_MAX);
  const objective = clip(text((parsed as Record<string, unknown>).objective), HISTORY_OBJECTIVE_MAX);
  return query && objective ? {query, objective} : undefined;
}
/** What a refused answer looked like, structurally (field names and lengths), for its telemetry row. */
export function describeHistoryQuery(parsed: unknown): string {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return `not an object (${Array.isArray(parsed) ? 'array' : typeof parsed})`;
  const row = parsed as Record<string, unknown>;
  return Object.keys(row).slice(0, 8).map(key => `${key}: ${typeof row[key] === 'string' ? `${(row[key] as string).length} chars` : typeof row[key]}`).join(', ') || 'empty object';
}
function clip(value: string, limit: number): string {
  let out = '';
  for (const char of value) { if (out.length + char.length > limit) break; out += char; }
  return out.trim();
}

/** The product port: one zero-tool completion per new scene, through the session's model registry. */
export function createHistoryQueryLane(pi: ExtensionAPI, options: {ctx: () => ExtensionContext | undefined; campaign: () => string | undefined}): HistoryQueryPort {
  const safeCtx = (): ExtensionContext | undefined => { try { return options.ctx(); } catch { return undefined; } };
  const telemetry = createLaneTelemetry(pi, {lane: HISTORY_QUERY_LANE, modelEnv: HISTORY_QUERY_MODEL_ENV, cwd: () => safeCtx()?.cwd});
  return {
    async write(facts: HistoryQueryFacts, signal: AbortSignal): Promise<HistoryQueryResult> {
      const began = Date.now();
      let campaign: string | undefined;
      try { campaign = options.campaign(); } catch { campaign = undefined; }
      const record = async (row: Record<string, unknown>): Promise<void> => {
        if (!campaign) return;
        try { await telemetry.record(campaign, row); } catch { /* telemetry never breaks the lookup */ }
      };
      const finish = async (result: HistoryQueryResult): Promise<HistoryQueryResult> => {
        await record(result.ok ? {ok: true, ms: result.ms, model: result.model ?? null, query: result.query, objective: result.objective}
          : {ok: false, ms: result.ms, model: result.model ?? null, reason: result.reason, detail: result.detail.slice(0, 200)});
        return result;
      };
      try {
        if (signal.aborted) return await finish({ok: false, reason: 'cancelled', detail: 'cancelled before the lane began', ms: 0});
        const ctx = safeCtx();
        if (!ctx) return await finish({ok: false, reason: 'no_session', detail: 'no session context to run the lane in', ms: 0});
        let refused: string | undefined;
        const lane = await runLane<{query: string; objective: string}>({
          ctx, envName: HISTORY_QUERY_MODEL_ENV, lane: HISTORY_QUERY_LANE, record, signal, timeoutMs: HISTORY_QUERY_TIMEOUT_MS,
          systemPrompt: HISTORY_QUERY_INSTRUCTION, input: JSON.stringify(facts),
          shape: parsed => { const checked = checkHistoryQuery(parsed); if (!checked) refused = describeHistoryQuery(parsed); return checked; },
        });
        if (lane.ok) return await finish({ok: true, query: lane.value.query, objective: lane.value.objective, ms: Date.now() - began, model: lane.model});
        const reason: HistoryQueryFailure = signal.aborted ? 'cancelled'
          : ['timeout', 'model_unavailable', 'model_error', 'bad_output'].includes(lane.reason) ? lane.reason as HistoryQueryFailure : 'lane_error';
        return await finish({ok: false, reason, detail: refused ? `${lane.detail}: ${refused}` : lane.detail, ms: Date.now() - began,
          ...(lane.model ? {model: lane.model} : {})});
      } catch (error) {
        return finish({ok: false, reason: 'lane_error', detail: error instanceof Error ? error.message : String(error), ms: Date.now() - began});
      }
    },
  };
}
