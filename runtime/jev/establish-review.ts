/**
 * Contract §203.6: before an establishing reply is delivered, the fast model reads the draft beside what the prose package
 * says establishing owes (`mods.establish.owes`) and answers, row by row, whether the draft shows it.
 *
 * One zero-tool completion on the fast model (`runLane`: this lane's variable, then the fast-model setting, then the
 * table), thinking off, no temperature. It is a short closed verdict on the turn's critical path, which is Agents.md's
 * single-completion rule. The judgement is the model's; the host checks the shape, that every `shown` row quotes the
 * prose (§139's quotation-mark class), and decides thin as "a row is missing". `review` never throws: a failure is
 * `{ok: false}` with a closed reason and the caller delivers.
 *
 * TR-F2 run 3 (2026-10-08): the newsroom arrived as two sentences (typewriters still clacking, index cards and clippings
 * spread on the desks) -- no room, no count of people, no object worth a look -- and nothing between the Keeper and the
 * player could tell.
 */
import type {ExtensionAPI, ExtensionContext} from '@earendil-works/pi-coding-agent';
import {runLane} from '../../extensions/lanes/subsession.ts';
import {createLaneTelemetry} from '../../extensions/lanes/telemetry.ts';
import {locateExcerpt} from '../../kernel-ts/read/excerpt.ts';

export const ESTABLISH_REVIEW_LANE = 'establish-review';
/** The operator's variable naming this lane's model (then the fast-model setting, then the table). */
export const ESTABLISH_REVIEW_MODEL_ENV = 'PI_COC_ESTABLISH_REVIEW_MODEL';
/** A watchdog for a review that hangs; the caller narrows it to the turn's own deadline. */
export const ESTABLISH_REVIEW_TIMEOUT_MS = 20000;
const QUOTE_CHARS = 400;

/** The host's own output contract, after the package's instruction: the shape is the host's, the judgement the model's. */
export const ESTABLISH_REVIEW_CONTRACT = [
  'The input JSON holds prose, the reply the Keeper drafted for the player; place and why, where the investigator is and why this reply must establish it; present, the people the table seats there (they may be absent from the prose); era, the setting\'s period when known; and owes, the rows an establishing reply owes, each with key and line.',
  'For every row of owes, in order, give one verdict: "shown" when the prose itself shows what the line asks, "missing" when it does not, "not_applicable" only when the line cannot apply to this place as the prose and the input set it (for example nobody else could be there).',
  'A shown verdict carries quote: one unbroken excerpt copied exactly, character for character, from prose, that shows it. A missing or not_applicable verdict carries no quote.',
  'Answer with one JSON object and nothing else: {"items": [{"key": "<key>", "verdict": "shown"|"missing"|"not_applicable", "quote": "<excerpt>"}]}.',
].join('\n');

export type EstablishVerdict = 'shown' | 'missing' | 'not_applicable';
export interface EstablishOwe {key: string; line: string}
export interface EstablishReviewInput {turn: number; prose: string; place: {id: string; name: string}; why: string[]; present: string[]; era?: string | null; owes: EstablishOwe[]}
export interface EstablishRow {key: string; verdict: EstablishVerdict; quote?: string}
export type EstablishReviewFailure = 'no_session' | 'cancelled' | 'timeout' | 'model_unavailable' | 'model_error' | 'bad_output' | 'lane_error';
export type EstablishReviewResult = {ok: true; thin: boolean; missing: string[]; shown: string[]; unanchored: string[]; rows: EstablishRow[]; ms: number; model?: string}
  | {ok: false; reason: EstablishReviewFailure; detail: string; ms: number; model?: string};
export interface EstablishReviewPort {review(input: EstablishReviewInput, options: {instruction: string; signal: AbortSignal; timeoutMs: number}): Promise<EstablishReviewResult>}

const VERDICTS: readonly string[] = ['shown', 'missing', 'not_applicable'];

/** The closed shape: one `{key, verdict, quote?}` per row asked, keys known, verdicts closed. */
export function checkEstablishAnswer(parsed: unknown, owes: readonly EstablishOwe[]): EstablishRow[] | undefined {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
  const items = (parsed as Record<string, unknown>).items;
  if (!Array.isArray(items)) return undefined;
  const keys = new Set(owes.map(owe => owe.key)), rows: EstablishRow[] = [], seen = new Set<string>();
  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return undefined;
    const {key, verdict, quote} = item as Record<string, unknown>;
    if (typeof key !== 'string' || !keys.has(key) || seen.has(key) || typeof verdict !== 'string' || !VERDICTS.includes(verdict)) return undefined;
    if (quote !== undefined && typeof quote !== 'string') return undefined;
    seen.add(key);
    rows.push({key, verdict: verdict as EstablishVerdict, ...(typeof quote === 'string' && quote.trim() ? {quote} : {})});
  }
  return seen.size === keys.size ? rows : undefined;
}

/**
 * The answer against the draft: a `shown` row whose quote is not found in the prose (§139's quotation marks folded, at
 * most `QUOTE_CHARS` characters) is not taken on the model's word -- it counts as missing, and is named `unanchored`. The
 * draft is thin when any row is missing.
 */
export function judgeEstablish(prose: string, rows: readonly EstablishRow[]): {thin: boolean; missing: string[]; shown: string[]; unanchored: string[]} {
  const missing: string[] = [], shown: string[] = [], unanchored: string[] = [];
  for (const row of rows) {
    if (row.verdict === 'not_applicable') continue;
    if (row.verdict === 'shown') {
      const located = row.quote && Array.from(row.quote).length <= QUOTE_CHARS ? locateExcerpt(prose, row.quote) : null;
      if (located) { shown.push(row.key); continue; }
      unanchored.push(row.key);
    }
    missing.push(row.key);
  }
  return {thin: missing.length > 0, missing, shown, unanchored};
}

function describe(parsed: unknown): string {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return `not an object (${Array.isArray(parsed) ? 'array' : typeof parsed})`;
  const row = parsed as Record<string, unknown>;
  return Object.keys(row).slice(0, 8).map(key => `${key}: ${Array.isArray(row[key]) ? `array(${(row[key] as unknown[]).length})` : typeof row[key]}`).join(', ') || 'empty object';
}

/** The product port: one zero-tool completion per establishing draft, through the session's model registry. */
export function createEstablishReviewLane(pi: ExtensionAPI, options: {ctx: () => ExtensionContext | undefined; campaign: () => string | undefined}): EstablishReviewPort {
  const safeCtx = (): ExtensionContext | undefined => { try { return options.ctx(); } catch { return undefined; } };
  const telemetry = createLaneTelemetry(pi, {lane: ESTABLISH_REVIEW_LANE, modelEnv: ESTABLISH_REVIEW_MODEL_ENV, cwd: () => safeCtx()?.cwd});
  return {
    async review(input, {instruction, signal, timeoutMs}): Promise<EstablishReviewResult> {
      const began = Date.now();
      let campaign: string | undefined;
      try { campaign = options.campaign(); } catch { campaign = undefined; }
      const record = async (row: Record<string, unknown>): Promise<void> => {
        if (!campaign) return;
        try { await telemetry.record(campaign, row); } catch { /* telemetry never breaks the review */ }
      };
      const finish = async (result: EstablishReviewResult): Promise<EstablishReviewResult> => {
        await record(result.ok
          ? {ok: true, turn: input.turn, ms: result.ms, model: result.model ?? null, thin: result.thin, missing: result.missing, unanchored: result.unanchored}
          : {ok: false, turn: input.turn, ms: result.ms, model: result.model ?? null, reason: result.reason, detail: result.detail.slice(0, 200)});
        return result;
      };
      try {
        if (signal.aborted) return await finish({ok: false, reason: 'cancelled', detail: 'cancelled before the lane began', ms: 0});
        const ctx = safeCtx();
        if (!ctx) return await finish({ok: false, reason: 'no_session', detail: 'no session context to run the lane in', ms: 0});
        let refused: string | undefined;
        const lane = await runLane<EstablishRow[]>({
          // Reasoning off, named here: a row-by-row comparison with quotes is not a deliberation, and the player waits.
          ctx, envName: ESTABLISH_REVIEW_MODEL_ENV, lane: ESTABLISH_REVIEW_LANE, record, signal, timeoutMs, thinking: 'off',
          systemPrompt: `${instruction.trim()}\n\n${ESTABLISH_REVIEW_CONTRACT}`,
          input: JSON.stringify({prose: input.prose, place: input.place, why: input.why, present: input.present, era: input.era ?? null, owes: input.owes}),
          shape: parsed => { const checked = checkEstablishAnswer(parsed, input.owes); if (!checked) refused = describe(parsed); return checked; },
        });
        if (lane.ok) return await finish({ok: true, ...judgeEstablish(input.prose, lane.value), rows: lane.value, ms: Date.now() - began, model: lane.model});
        const reason: EstablishReviewFailure = signal.aborted ? 'cancelled'
          : ['timeout', 'model_unavailable', 'model_error', 'bad_output'].includes(lane.reason) ? lane.reason as EstablishReviewFailure : 'lane_error';
        return await finish({ok: false, reason, detail: refused ? `${lane.detail}: ${refused}` : lane.detail, ms: Date.now() - began,
          ...(lane.model ? {model: lane.model} : {})});
      } catch (error) {
        return finish({ok: false, reason: 'lane_error', detail: error instanceof Error ? error.message : String(error), ms: Date.now() - began});
      }
    },
  };
}
