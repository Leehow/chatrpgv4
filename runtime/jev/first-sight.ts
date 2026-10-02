/**
 * Contract §168.5 (docs/specs/first-sight.md 2.4): after a delivery whose capsule carried `first_sight`, the fast model
 * reads the delivered prose beside the book's own words for each place and person it owed, and names what a newcomer
 * could see or hear on arrival that the prose did not show.
 *
 * One zero-tool completion on the fast model (`runLane`: this lane's variable, then the fast-model setting, then the
 * table), capped at 20 s, run in the background after the delivery: it never delays one, and the prose is never
 * refused or rewritten for it (§166). The semantic judgement is the model's. The host checks the closed shape and
 * that every excerpt is the item's own book words (§139's quotation-mark class, the book's span kept); an excerpt
 * found nowhere is dropped. `write` never throws: a failure is `{ok: false}` with a closed reason, and nothing is
 * recorded, so every item stays owed in full.
 */
import type {ExtensionAPI, ExtensionContext} from '@earendil-works/pi-coding-agent';
import {runLane} from '../../extensions/lanes/subsession.ts';
import {createLaneTelemetry} from '../../extensions/lanes/telemetry.ts';
import {locateExcerpt} from '../../kernel-ts/read/excerpt.ts';

/** The lane's name on every row it writes. */
export const FIRST_SIGHT_LANE = 'first-sight';
/** The operator's variable naming this lane's model (then the fast-model setting, then the table). */
export const FIRST_SIGHT_MODEL_ENV = 'PI_COC_FIRST_SIGHT_MODEL';
/**
 * A watchdog for a check that hangs, never a limit on one that is working: past it nothing is recorded and the items
 * stay owed. The check runs after the delivery and nothing waits for it, so a slow answer costs the player nothing.
 * The first cap was 20 s; on the installed App's Blood Road opening (2026-10-02) the fast model answered headers in
 * 2.1 s and was still writing the four items' excerpts when 20 s cut it off, and the owner's standing ruling is that
 * nothing working is cut short at a clock ("只防卡死，不掐慢").
 */
export const FIRST_SIGHT_TIMEOUT_MS = 120000;
/** The kernel's bounds (`table.first_sight`): excerpts per item and characters per excerpt. */
export const FIRST_SIGHT_MISSING_MAX = 24, FIRST_SIGHT_EXCERPT_CHARS = 800;

export const FIRST_SIGHT_INSTRUCTION = [
  'You check one reply of a tabletop horror game against what its book describes of a place or person the player was seeing for the first time.',
  'The input JSON holds prose, the reply the player just read, and items, each with id, kind (place or person) and described: the book\'s own words for it, in whatever language the book is written in.',
  'For each item, list the details of described that a newcomer arriving there could see or hear on arrival -- how the place looks, sounds and smells; a person\'s looks, build, apparent age, dress and manner -- and that the prose did not show.',
  'A detail the prose showed in other words or in another language counts as shown. Leave out what cannot be seen or heard on arrival: history, names nobody has said, secrets, motives, relationships, what someone knows or does elsewhere, rules and numbers.',
  'Copy each detail exactly as described writes it: one unbroken excerpt, character for character, a phrase or clause rather than the whole text.',
  'Answer with one JSON object and nothing else: {"items": [{"id": "<item id>", "missing": ["<excerpt>", ...]}]}, one entry for every item; missing is [] when the prose showed everything of it a newcomer could see or hear.',
].join('\n');

export type FirstSightFailure = 'no_session' | 'cancelled' | 'timeout' | 'model_unavailable' | 'model_error' | 'bad_output' | 'lane_error';
export interface FirstSightItem {id: string; kind: 'place' | 'person'; described: string}
/** One item the check answered: `missing` is the book's own spans the prose did not show; [] means shown. */
export interface FirstSightAnswer {id: string; kind: 'place' | 'person'; missing: string[]}
export type FirstSightResult = {ok: true; items: FirstSightAnswer[]; unanchored: string[]; ms: number; model?: string}
  | {ok: false; reason: FirstSightFailure; detail: string; ms: number; model?: string};
export interface FirstSightPort {check(input: {turn: number; prose: string; items: FirstSightItem[]}, signal: AbortSignal): Promise<FirstSightResult>}

/** The closed shape: `items` a list of `{id, missing: string[]}`. Its wording is the model's. */
export function checkFirstSightAnswer(parsed: unknown): Array<{id: string; missing: string[]}> | undefined {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
  const items = (parsed as Record<string, unknown>).items;
  if (!Array.isArray(items)) return undefined;
  const answers: Array<{id: string; missing: string[]}> = [];
  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return undefined;
    const {id, missing} = item as Record<string, unknown>;
    if (typeof id !== 'string' || !id.trim() || !Array.isArray(missing) || missing.some(value => typeof value !== 'string')) return undefined;
    answers.push({id: id.trim(), missing: (missing as string[]).filter(value => value.trim())});
  }
  return answers;
}

/**
 * The answer against what was asked. An item the answer leaves out is not recorded. An excerpt is kept only where it
 * is found in that item's own `described` (§139), as `described`'s own span; one found nowhere is unanchored and
 * dropped. An item whose excerpts were all unanchored is not recorded either: it was not shown, and the check could
 * not say what of it was missing, so it stays owed exactly as it was. Only an explicitly empty `missing` is shown.
 */
export function anchorFirstSight(items: readonly FirstSightItem[], answers: ReadonlyArray<{id: string; missing: string[]}>): {items: FirstSightAnswer[]; unanchored: string[]} {
  const kept: FirstSightAnswer[] = [], unanchored: string[] = [], seen = new Set<string>();
  for (const answer of answers) {
    const item = items.find(entry => entry.id === answer.id);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    const spans: string[] = [];
    for (const excerpt of answer.missing) {
      const located = Array.from(excerpt).length <= FIRST_SIGHT_EXCERPT_CHARS ? locateExcerpt(item.described, excerpt) : null;
      if (located && !spans.includes(located)) spans.push(located);
    }
    if (answer.missing.length && !spans.length) { unanchored.push(item.id); continue; }
    kept.push({id: item.id, kind: item.kind, missing: spans.slice(0, FIRST_SIGHT_MISSING_MAX)});
  }
  return {items: kept, unanchored};
}
/** What a refused answer looked like, structurally, for its telemetry row. */
function describeAnswer(parsed: unknown): string {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return `not an object (${Array.isArray(parsed) ? 'array' : typeof parsed})`;
  const row = parsed as Record<string, unknown>;
  return Object.keys(row).slice(0, 8).map(key => `${key}: ${Array.isArray(row[key]) ? 'array' : typeof row[key]}`).join(', ') || 'empty object';
}

/** The product port: one zero-tool completion per checked delivery, through the session's model registry. */
export function createFirstSightLane(pi: ExtensionAPI, options: {ctx: () => ExtensionContext | undefined; campaign: () => string | undefined}): FirstSightPort {
  const safeCtx = (): ExtensionContext | undefined => { try { return options.ctx(); } catch { return undefined; } };
  const telemetry = createLaneTelemetry(pi, {lane: FIRST_SIGHT_LANE, modelEnv: FIRST_SIGHT_MODEL_ENV, cwd: () => safeCtx()?.cwd});
  return {
    async check(input, signal): Promise<FirstSightResult> {
      const began = Date.now();
      let campaign: string | undefined;
      try { campaign = options.campaign(); } catch { campaign = undefined; }
      const record = async (row: Record<string, unknown>): Promise<void> => {
        if (!campaign) return;
        try { await telemetry.record(campaign, row); } catch { /* telemetry never breaks the check */ }
      };
      const finish = async (result: FirstSightResult): Promise<FirstSightResult> => {
        await record(result.ok
          ? {ok: true, turn: input.turn, ms: result.ms, model: result.model ?? null, items: input.items.length,
            shown: result.items.filter(item => !item.missing.length).length, missing: result.items.filter(item => item.missing.length).length,
            ...(result.unanchored.length ? {unanchored: result.unanchored.length} : {})}
          : {ok: false, turn: input.turn, ms: result.ms, model: result.model ?? null, items: input.items.length, reason: result.reason,
            detail: result.detail.slice(0, 200)});
        return result;
      };
      try {
        if (signal.aborted) return await finish({ok: false, reason: 'cancelled', detail: 'cancelled before the lane began', ms: 0});
        const ctx = safeCtx();
        if (!ctx) return await finish({ok: false, reason: 'no_session', detail: 'no session context to run the lane in', ms: 0});
        let refused: string | undefined;
        const lane = await runLane<Array<{id: string; missing: string[]}>>({
          ctx, envName: FIRST_SIGHT_MODEL_ENV, lane: FIRST_SIGHT_LANE, record, signal, timeoutMs: FIRST_SIGHT_TIMEOUT_MS, afterDelivery: true,
          systemPrompt: FIRST_SIGHT_INSTRUCTION,
          input: JSON.stringify({prose: input.prose, items: input.items.map(item => ({id: item.id, kind: item.kind, described: item.described}))}),
          shape: parsed => { const checked = checkFirstSightAnswer(parsed); if (!checked) refused = describeAnswer(parsed); return checked; },
        });
        if (lane.ok) {
          const anchored = anchorFirstSight(input.items, lane.value);
          return await finish({ok: true, ...anchored, ms: Date.now() - began, model: lane.model});
        }
        const reason: FirstSightFailure = signal.aborted ? 'cancelled'
          : ['timeout', 'model_unavailable', 'model_error', 'bad_output'].includes(lane.reason) ? lane.reason as FirstSightFailure : 'lane_error';
        return await finish({ok: false, reason, detail: refused ? `${lane.detail}: ${refused}` : lane.detail, ms: Date.now() - began,
          ...(lane.model ? {model: lane.model} : {})});
      } catch (error) {
        return finish({ok: false, reason: 'lane_error', detail: error instanceof Error ? error.message : String(error), ms: Date.now() - began});
      }
    },
  };
}
