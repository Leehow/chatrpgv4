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
  'query: at most 300 characters. Name the real historical period, the real region and the kind of place, e.g. "1975 West Texas small-town general store". Leave out the scenario\'s invented names of people and businesses; a real town, region or institution may stay.',
  'objective: at most 480 characters. Say which details of that time and place the scene needs: appearance, goods, how people worked and talked there. Ask for sources that show how it was at that time, not present-day travel guides, listings, opening hours or museum notes. Do not ask for prices.',
  'When the setting is fictional, name the real period and culture it borrows from instead.',
].join('\n');

export type HistoryQueryFailure = 'no_session' | 'cancelled' | 'timeout' | 'model_unavailable' | 'model_error' | 'bad_output' | 'lane_error';
export type HistoryQueryResult = {ok: true; query: string; objective: string; ms: number; model?: string}
  | {ok: false; reason: HistoryQueryFailure; detail: string; ms: number; model?: string};
export interface HistoryQueryFacts {era: string; place: string; summary?: string; background?: string}
export interface HistoryQueryPort {write(facts: HistoryQueryFacts, signal: AbortSignal): Promise<HistoryQueryResult>}

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

/** The closed shape: two nonempty strings within their bounds. Their wording is the model's. */
export function checkHistoryQuery(parsed: unknown): {query: string; objective: string} | undefined {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
  const query = text((parsed as Record<string, unknown>).query), objective = text((parsed as Record<string, unknown>).objective);
  if (!query || !objective || query.length > HISTORY_QUERY_MAX || objective.length > HISTORY_OBJECTIVE_MAX) return undefined;
  return {query, objective};
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
        const lane = await runLane<{query: string; objective: string}>({
          ctx, envName: HISTORY_QUERY_MODEL_ENV, lane: HISTORY_QUERY_LANE, record, signal, timeoutMs: HISTORY_QUERY_TIMEOUT_MS,
          systemPrompt: HISTORY_QUERY_INSTRUCTION, input: JSON.stringify(facts), shape: checkHistoryQuery,
        });
        if (lane.ok) return await finish({ok: true, query: lane.value.query, objective: lane.value.objective, ms: Date.now() - began, model: lane.model});
        const reason: HistoryQueryFailure = signal.aborted ? 'cancelled'
          : ['timeout', 'model_unavailable', 'model_error', 'bad_output'].includes(lane.reason) ? lane.reason as HistoryQueryFailure : 'lane_error';
        return await finish({ok: false, reason, detail: lane.detail, ms: Date.now() - began, ...(lane.model ? {model: lane.model} : {})});
      } catch (error) {
        return finish({ok: false, reason: 'lane_error', detail: error instanceof Error ? error.message : String(error), ms: Date.now() - began});
      }
    },
  };
}
