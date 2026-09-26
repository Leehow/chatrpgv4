/**
 * The SL-76 (§135.3.1, §135.32) `jev_steps` thresholds from `content/rulesets/coc7/host-budgets.json` -- the same
 * rules-data directory `extensions/kernel/index.ts`'s `lookBudget()` reads `look_budget` from (SL-72). Read once
 * per process and cached: the file does not change while a table is open. Thresholds live here, never as a
 * literal in `consequence-candidates.ts` or `hybrid-engine.ts`.
 *
 * SL-78 (§135.32 addendum 2) adds `execute`: the consequence classes `COC_JEV_STEPS=on` actually executes. A
 * class not in this list keeps the shadow path even when the env switch is `on` (routed, paired at turn close,
 * never executed) -- the per-class ruling is data, never a literal `if (class === 'clue_follow_up')` anywhere.
 */
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {extensionContentRoot} from '../../extensions/ui/words.ts';

export interface JevStepsBudget {
  /** The row gate (§135.30.9.1's `ROW_MIN`): a Noul's leading answer clears at least this probability. */
  rowMin: number;
  /** The row gate's margin (§135.30.9.1's `ROW_RATIO`): and at least this many times the opposite answer's. */
  rowRatio: number;
  /** The data file's own default for `COC_JEV_STEPS` when the environment does not set one. */
  shadow: boolean;
  /** SL-78: the consequence classes `COC_JEV_STEPS=on` executes; every other class stays shadow-only under `on`. */
  execute: readonly string[];
}

/** Used only if `content/rulesets/coc7/host-budgets.json` cannot be read; the shipped file carries the real default. */
export const JEV_STEPS_FALLBACK: JevStepsBudget = Object.freeze({rowMin: 0.5, rowRatio: 2, shadow: true, execute: Object.freeze([])});

let cached: Promise<JevStepsBudget> | undefined;

function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }

/**
 * The SL-76 thresholds, read once per process and cached. `contentRoot` is for tests only (a fixture directory);
 * production code always calls this with no argument, so it shares the one cache every other reader of
 * `host-budgets.json` would if it cached too.
 */
export function jevStepsBudget(contentRoot?: string): Promise<JevStepsBudget> {
  if (contentRoot !== undefined) return readJevStepsBudget(contentRoot);
  return cached ??= readJevStepsBudget();
}

async function readJevStepsBudget(contentRoot?: string): Promise<JevStepsBudget> {
  try {
    const raw = JSON.parse(await readFile(join(contentRoot ?? extensionContentRoot(), 'rulesets', 'coc7', 'host-budgets.json'), 'utf8')) as {
      jev_steps?: {row_min?: unknown; row_ratio?: unknown; shadow?: unknown; execute?: unknown};
    };
    const rowMin = raw.jev_steps?.row_min, rowRatio = raw.jev_steps?.row_ratio, shadow = raw.jev_steps?.shadow, execute = raw.jev_steps?.execute;
    return {
      rowMin: finite(rowMin) && rowMin > 0 && rowMin < 1 ? rowMin : JEV_STEPS_FALLBACK.rowMin,
      rowRatio: finite(rowRatio) && rowRatio > 1 ? rowRatio : JEV_STEPS_FALLBACK.rowRatio,
      shadow: typeof shadow === 'boolean' ? shadow : JEV_STEPS_FALLBACK.shadow,
      execute: Array.isArray(execute) ? Object.freeze(execute.filter((value): value is string => typeof value === 'string')) : JEV_STEPS_FALLBACK.execute,
    };
  } catch {
    return JEV_STEPS_FALLBACK;
  }
}

/** Test-only: forgets the cached value, so a test that swaps the content root sees its own fixture. */
export function resetJevStepsBudgetCache(): void { cached = undefined; }

/**
 * SL-82 (contract §135.29 addendum 2): the step-1 call's own allowance when `COC_FIRST_STEP_THINKING=1`
 * (`extensions/kernel/first-step-thinking.ts`'s `firstStepCallCapMs`, `runtime/jev/hybrid-engine.ts`'s
 * per-call `keeperCallCapMs`). A named default in the same rules-data file `jev_steps`/`look_budget` live
 * in, not a literal in `hybrid-engine.ts` -- so raising it after a slower model is a data change.
 */
export interface FirstStepThinkingBudget {
  /** `first_step_thinking.call_cap_ms`: `firstStepCallCapMs` takes the larger of this and the ordinary
   * SL-69 cap for the turn's first Keeper call. From the ≈35 s thinking call measured in long gates #9/#14. */
  callCapMs: number;
}

/** Used only if `content/rulesets/coc7/host-budgets.json` cannot be read; the shipped file carries the real default. */
export const FIRST_STEP_THINKING_BUDGET_FALLBACK: FirstStepThinkingBudget = Object.freeze({callCapMs: 60_000});

let firstStepThinkingCached: Promise<FirstStepThinkingBudget> | undefined;

/**
 * SL-82's allowance, read once per process and cached like `jevStepsBudget` above. `contentRoot` is for
 * tests only; production code always calls this with no argument.
 */
export function firstStepThinkingBudget(contentRoot?: string): Promise<FirstStepThinkingBudget> {
  if (contentRoot !== undefined) return readFirstStepThinkingBudget(contentRoot);
  return firstStepThinkingCached ??= readFirstStepThinkingBudget();
}

async function readFirstStepThinkingBudget(contentRoot?: string): Promise<FirstStepThinkingBudget> {
  try {
    const raw = JSON.parse(await readFile(join(contentRoot ?? extensionContentRoot(), 'rulesets', 'coc7', 'host-budgets.json'), 'utf8')) as {
      first_step_thinking?: {call_cap_ms?: unknown};
    };
    const callCapMs = raw.first_step_thinking?.call_cap_ms;
    return {callCapMs: finite(callCapMs) && callCapMs > 0 ? callCapMs : FIRST_STEP_THINKING_BUDGET_FALLBACK.callCapMs};
  } catch {
    return FIRST_STEP_THINKING_BUDGET_FALLBACK;
  }
}

/** Test-only: forgets the cached value, so a test that swaps the content root sees its own fixture. */
export function resetFirstStepThinkingBudgetCache(): void { firstStepThinkingCached = undefined; }
