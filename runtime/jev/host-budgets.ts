/**
 * The SL-76 (§135.3.1, §135.32) `jev_steps` thresholds from `content/rulesets/coc7/host-budgets.json` -- the same
 * rules-data directory `extensions/kernel/index.ts`'s `lookBudget()` reads `look_budget` from (SL-72). Read once
 * per process and cached: the file does not change while a table is open. Thresholds live here, never as a
 * literal in `consequence-candidates.ts` or `hybrid-engine.ts`.
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
}

/** Used only if `content/rulesets/coc7/host-budgets.json` cannot be read; the shipped file carries the real default. */
export const JEV_STEPS_FALLBACK: JevStepsBudget = Object.freeze({rowMin: 0.5, rowRatio: 2, shadow: true});

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
      jev_steps?: {row_min?: unknown; row_ratio?: unknown; shadow?: unknown};
    };
    const rowMin = raw.jev_steps?.row_min, rowRatio = raw.jev_steps?.row_ratio, shadow = raw.jev_steps?.shadow;
    return {
      rowMin: finite(rowMin) && rowMin > 0 && rowMin < 1 ? rowMin : JEV_STEPS_FALLBACK.rowMin,
      rowRatio: finite(rowRatio) && rowRatio > 1 ? rowRatio : JEV_STEPS_FALLBACK.rowRatio,
      shadow: typeof shadow === 'boolean' ? shadow : JEV_STEPS_FALLBACK.shadow,
    };
  } catch {
    return JEV_STEPS_FALLBACK;
  }
}

/** Test-only: forgets the cached value, so a test that swaps the content root sees its own fixture. */
export function resetJevStepsBudgetCache(): void { cached = undefined; }
