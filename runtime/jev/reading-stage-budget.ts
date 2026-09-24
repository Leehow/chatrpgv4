/**
 * The provider lease an import's reading stage pays from, sized to the book (contract §20 addendum 2, SL-35).
 *
 * One lease per stage the onboarding worker runs, handed to the stage's reading as its `providerBudget`. It
 * replaced a fixed per-child lease (1,000,000 input tokens) that a 669-page book's opening could not survive:
 * an image call reserves the reader's whole context window and a call that ends in a provider error is
 * charged that whole reservation, so one stream timeout and its retry used it up.
 */
import {readdir, readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {TaskLease} from './task-context.ts';
import {createTaskProviderBudget, type TaskProviderBudget} from './provider-budget.ts';

export type ReadingStage = 'inspect' | 'guidance' | 'opening' | 'prepare';
export interface PageCost {inputTokens: number; outputTokens: number; actions: number; costUsd: number}

/**
 * The named defaults. Every number here is a rule, not a measurement to re-derive at the call site.
 *
 * - `perPage`: what one page costs the reader when this book has not measured it yet. Masks' measured
 *   opening round was 213,189 input / 11,401 output tokens over 16 page images in 6 calls.
 * - `share`: how much of the whole book, read once, a stage may spend. `inspect` makes no provider call.
 * - `floor`: eight whole-context reservations of a 500,000-token reader, so a stalled image call and its
 *   retry fit in each of two rounds with the review still to pay; `ceiling`: the absolute cap.
 * - `minMeasuredPages`: fewer measured pages than this is not a measurement.
 * - `callOutputTokens`: each call's output bound. A draft is written in one tool call, and Masks' draft
 *   call reported 10,933 output tokens against the default 8,192.
 */
export const READING_STAGE_BUDGET = Object.freeze({
  perPage: Object.freeze({inputTokens: 16_000, outputTokens: 1_000, actions: 0.5, costUsd: 0.03}),
  share: Object.freeze({inspect: 0, guidance: 0.5, opening: 1, prepare: 1.5}),
  floor: Object.freeze({inputTokens: 4_000_000, outputTokens: 262_144, actions: 64, costUsd: 10}),
  ceiling: Object.freeze({inputTokens: 40_000_000, outputTokens: 2_000_000, actions: 800, costUsd: 100}),
  minMeasuredPages: 4,
  deadlineMs: 2 * 3_600_000,
  callOutputTokens: 32_768,
});

export interface StageBudget {
  stage: ReadingStage; pageCount: number; perPage: PageCost; measured: boolean;
  inputTokens: number; outputTokens: number; actions: number; costUsd: number;
  deadlineMs: number; callOutputTokens: number;
}

const DIMENSIONS = ['inputTokens', 'outputTokens', 'actions', 'costUsd'] as const;
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/** The stage's lease: per dimension, clamp(floor, pages × per-page × share, ceiling). `null` for a stage that calls no provider. */
export function readingStageBudget(stage: ReadingStage, options: {pageCount: number; perPage?: PageCost}): StageBudget | null {
  const share = READING_STAGE_BUDGET.share[stage];
  if (share === undefined) throw new Error(`unknown reading stage: ${stage}`);
  if (!share) return null;
  const pageCount = Number.isSafeInteger(options.pageCount) && options.pageCount > 0 ? options.pageCount : 0;
  // A measurement can raise the per-page cost, never lower it below the default: it counts the author's
  // rounds only, while the stage's lease also pays the independent review of every page read.
  const perPage = Object.fromEntries(DIMENSIONS.map(key => [key, Math.max(READING_STAGE_BUDGET.perPage[key], options.perPage?.[key] ?? 0)])) as unknown as PageCost;
  const sized = Object.fromEntries(DIMENSIONS.map(key => {
    const raw = clamp(pageCount * perPage[key] * share, READING_STAGE_BUDGET.floor[key], READING_STAGE_BUDGET.ceiling[key]);
    return [key, key === 'costUsd' ? raw : Math.ceil(raw)];
  })) as Record<typeof DIMENSIONS[number], number>;
  return {stage, pageCount, perPage: {...perPage}, measured: !!options.perPage, ...sized,
    deadlineMs: READING_STAGE_BUDGET.deadlineMs, callOutputTokens: READING_STAGE_BUDGET.callOutputTokens};
}

/**
 * The reader's measured cost per page of this book: the `usage.jsonl` rows its author rounds wrote
 * (`work/<job>/attempt-*`), completed rounds that read pages only. Undefined below `minMeasuredPages`.
 */
export async function measuredPageCost(moduleDir: string): Promise<PageCost | undefined> {
  const total = {inputTokens: 0, outputTokens: 0, actions: 0, costUsd: 0, pages: 0};
  let jobs: string[] = [];
  try { jobs = await readdir(join(moduleDir, 'work')); } catch { return undefined; }
  for (const job of jobs) {
    let attempts: string[] = [];
    try { attempts = await readdir(join(moduleDir, 'work', job)); } catch { continue; }
    for (const attempt of attempts) {
      let text = '';
      try { text = await readFile(join(moduleDir, 'work', job, attempt, 'usage.jsonl'), 'utf8'); } catch { continue; }
      for (const line of text.split('\n')) {
        let row: any;
        try { row = JSON.parse(line); } catch { continue; }
        if (row?.ok !== true || !['read', 'index', 'index-audit'].includes(row.phase) || !(Number.isSafeInteger(row.pages) && row.pages > 0)) continue;
        const usage = row.usage;
        if (!usage || !DIMENSIONS.every(key => Number.isFinite(usage[key]) && usage[key] >= 0)) continue;
        for (const key of DIMENSIONS) total[key] += usage[key];
        total.pages += row.pages;
      }
    }
  }
  if (total.pages < READING_STAGE_BUDGET.minMeasuredPages) return undefined;
  return Object.fromEntries(DIMENSIONS.map(key => [key, total[key] / total.pages])) as unknown as PageCost;
}

/** Open the stage's lease. The caller closes it when the stage ends; readings it queued in the background keep their own. */
export function openStageProviderBudget(sized: StageBudget, options: {signal?: AbortSignal; record?: (event: Record<string, unknown>) => void; now?: number} = {}):
  {budget: TaskProviderBudget; close(): void} {
  const owner = `import-${sized.stage}`;
  const lease = new TaskLease({owner, goal: `Read the book for the ${sized.stage} stage`, scope: {owner, audience: 'system'}, capabilities: [], readSet: [], signal: options.signal,
    budget: {deadlineAt: (options.now ?? Date.now()) + sized.deadlineMs, remainingInputTokens: sized.inputTokens, remainingOutputTokens: sized.outputTokens,
      remainingCostUsd: sized.costUsd, remainingActions: sized.actions}});
  return {budget: createTaskProviderBudget(lease, {callOutputTokens: sized.callOutputTokens, ...(options.record ? {record: options.record} : {})}), close: () => lease.close()};
}

/**
 * Run one import stage's reading under its own lease: size it from the module's `page_count` and the
 * reader's measured cost per page, report the size (`stage_budget`), hand `{providerBudget}` to `body`, and
 * close the lease when the stage ends. A stage that calls no provider, or a reader command that is not a Pi
 * child (`PI_COC_READER_CMD`, which has no provider channel to account), runs with no lease.
 */
export async function withStageLease<T>(stage: ReadingStage, options: {moduleDir: string; env: Record<string, string | undefined>; signal?: AbortSignal;
  report?: (row: Record<string, unknown>) => void}, body: (reading: {providerBudget?: TaskProviderBudget}) => Promise<T>): Promise<T> {
  let pageCount = 0;
  try { pageCount = Number(JSON.parse(await readFile(join(options.moduleDir, 'module.json'), 'utf8')).page_count) || 0; }
  catch { /* an unregistered module is refused by the reading itself */ }
  const sized = options.env.PI_COC_READER_CMD?.trim() ? null
    : readingStageBudget(stage, {pageCount, perPage: await measuredPageCost(options.moduleDir)});
  if (!sized) return body({});
  const lease = openStageProviderBudget(sized, {signal: options.signal});
  options.report?.({lane: 'reading', event: 'stage_budget', ...sized});
  try { return await body({providerBudget: lease.budget}); }
  finally { lease.close(); }
}
