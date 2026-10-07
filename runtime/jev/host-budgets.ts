/**
 * The SL-76 (§135.3.1, §135.32) `jev_steps` thresholds from `content/rulesets/coc7/host-budgets.json` -- the same
 * rules-data directory `extensions/kernel/index.ts`'s `lookBudget()` reads `look_budget` from (SL-72). Read once
 * per process and cached: the file does not change while a table is open. Thresholds live here, never as a
 * literal in `consequence-candidates.ts` or `hybrid-engine.ts`.
 *
 * SL-78 (§135.32 addendum 2) adds `execute`: the consequence classes `COC_JEV_STEPS=on` actually executes. A
 * class not in this list keeps the shadow path even when the env switch is `on` (routed, paired at turn close,
 * never executed) -- the per-class ruling is data, never a literal `if (class === 'clue_follow_up')` anywhere.
 *
 * SL-86 (§135.32 addendum 3) adds `classes`: a per-class override of `rowMin` only (`rowRatio` stays the one
 * shared value, §135.32 addendum 3's reasoning). A class not named here, or named with an out-of-range value,
 * falls back to the shared `rowMin`/`rowRatio` field by field -- `thresholdsForClass` is the one place that
 * fallback happens, never a literal per class in `consequence-route.ts`/`hybrid-engine.ts`.
 */
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {extensionContentRoot} from '../../extensions/ui/words.ts';
import {ADMISSION_TYPED_DESIGNS, type AdmissionTypedDesign} from './admission-domain.ts';

export interface JevStepsBudget {
  /** The row gate (§135.30.9.1's `ROW_MIN`): a Noul's leading answer clears at least this probability. */
  rowMin: number;
  /** The row gate's margin (§135.30.9.1's `ROW_RATIO`): and at least this many times the opposite answer's. */
  rowRatio: number;
  /** The data file's own default for `COC_JEV_STEPS` when the environment does not set one. */
  shadow: boolean;
  /** SL-78: the consequence classes `COC_JEV_STEPS=on` executes; every other class stays shadow-only under `on`. */
  execute: readonly string[];
  /** SL-86: a per-class override of `rowMin`, keyed by class name; a class absent here uses the shared `rowMin`. */
  classRowMin: Readonly<Record<string, number>>;
  /** SL-86 follow-up (§135.32 addendum 3.1): a per-class `rowRatio` override. For a Noul the two gates collapse into one
   *  number (`yes >= ratio/(1+ratio)`), so a class that lowers `rowMin` must be allowed to lower the ratio too. */
  classRowRatio: Readonly<Record<string, number>>;
}

/** Used only if `content/rulesets/coc7/host-budgets.json` cannot be read; the shipped file carries the real default. */
export const JEV_STEPS_FALLBACK: JevStepsBudget = Object.freeze({rowMin: 0.5, rowRatio: 2, shadow: true, execute: Object.freeze([]), classRowMin: Object.freeze({}), classRowRatio: Object.freeze({})});

/**
 * SL-86 (§135.32 addendum 3): the class's own `{rowMin, rowRatio}`, falling back to the shared gate field by
 * field. A per-class `rowRatio` is allowed too (addendum 3.1): for a Noul the ratio gate is `yes >= ratio/(1+ratio)`,
 * so the shared ratio of 2 (an effective 0.667) would silently override any lower per-class `rowMin`.
 */
export function thresholdsForClass(budget: Pick<JevStepsBudget, 'rowMin' | 'rowRatio' | 'classRowMin' | 'classRowRatio'>, cls: string): {rowMin: number; rowRatio: number} {
  const rowMin = budget.classRowMin[cls], rowRatio = budget.classRowRatio?.[cls];
  return {rowMin: typeof rowMin === 'number' ? rowMin : budget.rowMin, rowRatio: typeof rowRatio === 'number' ? rowRatio : budget.rowRatio};
}

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
      jev_steps?: {row_min?: unknown; row_ratio?: unknown; shadow?: unknown; execute?: unknown; classes?: unknown};
    };
    const rowMin = raw.jev_steps?.row_min, rowRatio = raw.jev_steps?.row_ratio, shadow = raw.jev_steps?.shadow, execute = raw.jev_steps?.execute;
    const classes = raw.jev_steps?.classes, classRowMin: Record<string, number> = {}, classRowRatio: Record<string, number> = {};
    if (classes && typeof classes === 'object' && !Array.isArray(classes))
      for (const [cls, shape] of Object.entries(classes as Record<string, unknown>)) {
        const classRowMinValue = shape && typeof shape === 'object' && !Array.isArray(shape) ? (shape as Record<string, unknown>).row_min : undefined;
        if (finite(classRowMinValue) && classRowMinValue > 0 && classRowMinValue < 1) classRowMin[cls] = classRowMinValue;
        const classRowRatioValue = shape && typeof shape === 'object' && !Array.isArray(shape) ? (shape as Record<string, unknown>).row_ratio : undefined;
        if (finite(classRowRatioValue) && classRowRatioValue > 0) classRowRatio[cls] = classRowRatioValue;
      }
    return {
      rowMin: finite(rowMin) && rowMin > 0 && rowMin < 1 ? rowMin : JEV_STEPS_FALLBACK.rowMin,
      rowRatio: finite(rowRatio) && rowRatio > 1 ? rowRatio : JEV_STEPS_FALLBACK.rowRatio,
      shadow: typeof shadow === 'boolean' ? shadow : JEV_STEPS_FALLBACK.shadow,
      execute: Array.isArray(execute) ? Object.freeze(execute.filter((value): value is string => typeof value === 'string')) : JEV_STEPS_FALLBACK.execute,
      classRowMin: Object.freeze(classRowMin),
      classRowRatio: Object.freeze(classRowRatio),
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

/**
 * §151.5 (SL-79 behind a setting): the narrator-only compose catalog's data default and `propose`'s per-turn cap, from the
 * same rules-data file. `runtime/jev/narrator-catalog.ts`'s `narratorOnlySetting` puts the env switch over `enabled`.
 */
export interface NarratorOnlyBudget {
  /** `narrator_only.enabled`: the setting when `COC_NARRATOR_ONLY` does not say `on` or `off` (shipped `false`). */
  enabled: boolean;
  /** `narrator_only.propose_per_turn`: `propose` requests one turn may queue, a whole number >= 0. */
  proposePerTurn: number;
}

/** Used only if the file or its `narrator_only` section cannot be read; the shipped file carries the real default. */
export const NARRATOR_ONLY_FALLBACK: NarratorOnlyBudget = Object.freeze({enabled: false, proposePerTurn: 2});

let narratorOnlyCached: Promise<NarratorOnlyBudget> | undefined;

/** Read once per process and cached, like `jevStepsBudget`; `contentRoot` is for tests only and is never cached. */
export function narratorOnlyBudget(contentRoot?: string): Promise<NarratorOnlyBudget> {
  if (contentRoot !== undefined) return readNarratorOnlyBudget(contentRoot);
  return narratorOnlyCached ??= readNarratorOnlyBudget();
}

async function readNarratorOnlyBudget(contentRoot?: string): Promise<NarratorOnlyBudget> {
  try {
    const raw = JSON.parse(await readFile(join(contentRoot ?? extensionContentRoot(), 'rulesets', 'coc7', 'host-budgets.json'), 'utf8')) as {
      narrator_only?: {enabled?: unknown; propose_per_turn?: unknown};
    };
    const enabled = raw.narrator_only?.enabled, cap = raw.narrator_only?.propose_per_turn;
    return {enabled: typeof enabled === 'boolean' ? enabled : NARRATOR_ONLY_FALLBACK.enabled,
      proposePerTurn: Number.isInteger(cap) && (cap as number) >= 0 ? cap as number : NARRATOR_ONLY_FALLBACK.proposePerTurn};
  } catch {
    return NARRATOR_ONLY_FALLBACK;
  }
}

/** Test-only: forgets the cached value, so a test that swaps the content root sees its own fixture. */
export function resetNarratorOnlyBudgetCache(): void { narratorOnlyCached = undefined; }

/**
 * SL-93 (§135.11.4.1, "one floor for every delivery path"): the prose floor every delivery -- the implicit close, an
 * explicit `narrate`, and `apply`'s embedded one -- is measured against. A named default in the same rules-data file
 * the look budget and the Jev step thresholds live in, not a literal in `extensions/kernel/index.ts`, so raising it
 * after a table that writes longer is a data change.
 */
export interface DeliveryFloorBudget {
  /** `delivery_floor.min_prose_chars`: Unicode code points of rendered prose (markers and say tokens removed, the
   *  spoken words inside a span left standing) a delivery needs before the turn's one floor steer lets it stand. */
  minProseChars: number;
}

/** Used only if `content/rulesets/coc7/host-budgets.json` cannot be read; the shipped file carries the real default. */
export const DELIVERY_FLOOR_FALLBACK: DeliveryFloorBudget = Object.freeze({minProseChars: 40});

let deliveryFloorCached: Promise<DeliveryFloorBudget> | undefined;

/**
 * SL-93's floor, read once per process and cached like `jevStepsBudget`/`firstStepThinkingBudget` above.
 * `contentRoot` is for tests only; production code always calls this with no argument.
 */
export function deliveryFloorBudget(contentRoot?: string): Promise<DeliveryFloorBudget> {
  if (contentRoot !== undefined) return readDeliveryFloorBudget(contentRoot);
  return deliveryFloorCached ??= readDeliveryFloorBudget();
}

async function readDeliveryFloorBudget(contentRoot?: string): Promise<DeliveryFloorBudget> {
  try {
    const raw = JSON.parse(await readFile(join(contentRoot ?? extensionContentRoot(), 'rulesets', 'coc7', 'host-budgets.json'), 'utf8')) as {
      delivery_floor?: {min_prose_chars?: unknown};
    };
    const minProseChars = raw.delivery_floor?.min_prose_chars;
    return {minProseChars: finite(minProseChars) && minProseChars > 0 ? minProseChars : DELIVERY_FLOOR_FALLBACK.minProseChars};
  } catch {
    return DELIVERY_FLOOR_FALLBACK;
  }
}

/** Test-only: forgets the cached value, so a test that swaps the content root sees its own fixture. */
export function resetDeliveryFloorBudgetCache(): void { deliveryFloorCached = undefined; }

/**
 * 2026-09-29 (contract §37.11.1): the lowest reasoning level a lane is given when it runs after the turn was
 * delivered -- the player is not waiting on it -- and it must hand back a strict, validated artifact. One fast
 * model setting serves both kinds of lane; at `off` the blocking admission review was 1.4 s faster per call
 * (2.4 s vs 3.8 s median), while the post-delivery continuity review failed its artifact on 13 of 15 turns
 * (1 of 14 at `low`, same build, same model). The floor keeps the setting's speed where the player waits and
 * spends reasoning only where they do not.
 */
export interface AfterDeliveryLaneBudget {
  /** `after_delivery_lanes.thinking_floor`: one of Pi's levels; a lane below it is raised to it. */
  thinkingFloor: string;
}

/** Used only if `content/rulesets/coc7/host-budgets.json` cannot be read; the shipped file carries the real value. */
export const AFTER_DELIVERY_LANE_FALLBACK: AfterDeliveryLaneBudget = Object.freeze({thinkingFloor: 'low'});

const afterDeliveryLaneCached = new Map<string, Promise<AfterDeliveryLaneBudget>>();
const THINKING_LEVELS = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);

/** Read once per content root and cached, like `readingIdleBudget` below; no argument means the extension's own content. */
export function afterDeliveryLaneBudget(contentRoot?: string): Promise<AfterDeliveryLaneBudget> {
  const key = contentRoot ?? '';
  let cached = afterDeliveryLaneCached.get(key);
  if (!cached) afterDeliveryLaneCached.set(key, cached = readAfterDeliveryLaneBudget(contentRoot));
  return cached;
}

async function readAfterDeliveryLaneBudget(contentRoot?: string): Promise<AfterDeliveryLaneBudget> {
  try {
    const raw = JSON.parse(await readFile(join(contentRoot ?? extensionContentRoot(), 'rulesets', 'coc7', 'host-budgets.json'), 'utf8')) as {
      after_delivery_lanes?: {thinking_floor?: unknown};
    };
    const floor = raw.after_delivery_lanes?.thinking_floor;
    return {thinkingFloor: typeof floor === 'string' && THINKING_LEVELS.has(floor) ? floor : AFTER_DELIVERY_LANE_FALLBACK.thinkingFloor};
  } catch {
    return AFTER_DELIVERY_LANE_FALLBACK;
  }
}

/** Test-only: forgets the cached values. */
export function resetAfterDeliveryLaneBudgetCache(): void { afterDeliveryLaneCached.clear(); }

/**
 * SL-99 (contract §140.1): how long a **reader** child's provider stream may say nothing before its transport and
 * the stream watchdog give up (`httpIdleTimeoutMs`, written into that child's own project settings by
 * `extensions/module/reader.ts`). Only `runtime/tasks.ts`'s `reader` tasks take it: the Keeper keeps the agent home's
 * value (`runtime/launch.ts`) and a `mod` lane child keeps `LANE_HTTP_IDLE_TIMEOUT_MS`.
 *
 * A grok-family reader writes its draft in one tool call whose arguments arrive in a single burst once the model has
 * finished generating them, so the stream is silent for as long as that generation takes (§140.1's table). A named
 * default in the same rules-data file as the other host budgets, so a slower reader model is a data change.
 */
export interface ReadingIdleBudget {
  /** `reading.idle_ms`: the reader child's idle allowance in milliseconds, a positive whole number. */
  idleMs: number;
}

/** Used only if `content/rulesets/coc7/host-budgets.json` cannot be read; the shipped file carries the real default. */
export const READING_IDLE_FALLBACK: ReadingIdleBudget = Object.freeze({idleMs: 180_000});

const readingIdleCached = new Map<string, Promise<ReadingIdleBudget>>();

/**
 * The reader's idle allowance, read once per content root and cached (the file does not change while a host runs).
 * Unlike the table's readers above, `runtime/tasks.ts` passes its own captured `context.contentRoot`, so a packaged
 * App reads the file it shipped with; with no argument the extensions' content root is used.
 */
export function readingIdleBudget(contentRoot?: string): Promise<ReadingIdleBudget> {
  const root = contentRoot ?? extensionContentRoot();
  let pending = readingIdleCached.get(root);
  if (!pending) readingIdleCached.set(root, pending = readReadingIdleBudget(root));
  return pending;
}

async function readReadingIdleBudget(contentRoot: string): Promise<ReadingIdleBudget> {
  try {
    const raw = JSON.parse(await readFile(join(contentRoot, 'rulesets', 'coc7', 'host-budgets.json'), 'utf8')) as {
      reading?: {idle_ms?: unknown};
    };
    const idleMs = raw.reading?.idle_ms;
    return {idleMs: finite(idleMs) && idleMs >= 1 ? Math.floor(idleMs) : READING_IDLE_FALLBACK.idleMs};
  } catch {
    return READING_IDLE_FALLBACK;
  }
}

/** Test-only: forgets the cached values, so a test that rewrites a content root sees its own fixture. */
export function resetReadingIdleBudgetCache(): void { readingIdleCached.clear(); }

/**
 * Contract §186.1: the image-count budget of a reader child's context hook for the authors and reviewers of a
 * `guidance`/`opening`/`detail`/`answer` reading, chosen by RC-01's replay of the retained reading logs
 * (`tests/play/reading_image_replay.py`). Data (`reading_images.count`), never a literal at the call sites.
 *
 * Unlike the other budgets there is no fallback number: an unreadable file or an invalid entry yields `undefined`, and the
 * child then keeps the hook's own general budget, so the replayed choice exists in exactly one place.
 */
export interface ReadingImageBudget {
  /** `reading_images.count`: images a reading child's request may hold before its oldest delivered ones are evicted. */
  count: number | undefined;
}

const readingImageCached = new Map<string, Promise<ReadingImageBudget>>();

/** The reading image budget, read once per content root and cached, like `readingIdleBudget`. */
export function readingImageBudget(contentRoot?: string): Promise<ReadingImageBudget> {
  const root = contentRoot ?? extensionContentRoot();
  let pending = readingImageCached.get(root);
  if (!pending) readingImageCached.set(root, pending = readReadingImageBudget(root));
  return pending;
}

async function readReadingImageBudget(contentRoot: string): Promise<ReadingImageBudget> {
  try {
    const raw = JSON.parse(await readFile(join(contentRoot, 'rulesets', 'coc7', 'host-budgets.json'), 'utf8')) as {
      reading_images?: {count?: unknown};
    };
    const count = raw.reading_images?.count;
    return {count: finite(count) && Number.isInteger(count) && count >= 2 ? count : undefined};
  } catch {
    return {count: undefined};
  }
}

/** Test-only: forgets the cached values, so a test that rewrites a content root sees its own fixture. */
export function resetReadingImageBudgetCache(): void { readingImageCached.clear(); }

/**
 * Contract §187.8.1: how many records one independent source reviewer takes. Records whose page sets overlap share a
 * reviewer while the union of their cited pages stays within `images` distinct pages and the unit holds fewer than
 * `max_records` records. Data (`reading_review`), never a literal in `extensions/module/reader-review.ts`.
 */
export interface ReadingReviewBudget {
  /** `reading_review.images`: distinct cited pages one review unit may span. */
  images: number;
  /** `reading_review.max_records`: records one review unit may hold. */
  maxRecords: number;
}

/** Used only if `content/rulesets/coc7/host-budgets.json` cannot be read; the shipped file carries the real default. */
export const READING_REVIEW_FALLBACK: ReadingReviewBudget = Object.freeze({images: 12, maxRecords: 32});

const readingReviewCached = new Map<string, Promise<ReadingReviewBudget>>();

/** The review unit budget, read once per content root and cached, like `readingImageBudget`. */
export function readingReviewBudget(contentRoot?: string): Promise<ReadingReviewBudget> {
  const root = contentRoot ?? extensionContentRoot();
  let pending = readingReviewCached.get(root);
  if (!pending) readingReviewCached.set(root, pending = readReadingReviewBudget(root));
  return pending;
}

async function readReadingReviewBudget(contentRoot: string): Promise<ReadingReviewBudget> {
  try {
    const raw = JSON.parse(await readFile(join(contentRoot, 'rulesets', 'coc7', 'host-budgets.json'), 'utf8')) as {
      reading_review?: {images?: unknown; max_records?: unknown};
    };
    const images = raw.reading_review?.images, maxRecords = raw.reading_review?.max_records;
    return {
      images: finite(images) && Number.isInteger(images) && images >= 1 ? images : READING_REVIEW_FALLBACK.images,
      maxRecords: finite(maxRecords) && Number.isInteger(maxRecords) && maxRecords >= 1 ? maxRecords : READING_REVIEW_FALLBACK.maxRecords,
    };
  } catch {
    return READING_REVIEW_FALLBACK;
  }
}

/** Test-only: forgets the cached values, so a test that rewrites a content root sees its own fixture. */
export function resetReadingReviewBudgetCache(): void { readingReviewCached.clear(); }

/**
 * SL-97 phase 2b (contract §32.12.3.2): the typed admission reviewer's design and the one rule by which its reading may
 * settle a line alone -- `admission` in the same rules-data file as the other host budgets, so widening the classes after a
 * new measurement is a data change, never a literal in `extensions/kernel/admission.ts`.
 *
 * - `typed_design`: which typed design reads every review (`roles-2a.3`, the measured one; `v1`, §32.10's, kept for
 *   comparison: its reading is recorded and never settles).
 * - `typed_settle.classes`: the line classes (closed effect kinds) whose typed admission may settle the line without the
 *   lane -- the classes that met SL-97's pre-registered bar on the holdout. `admission.ts` keeps only those inside §32.11's
 *   closed set (`FAST_PATH_KINDS`), so this list can narrow the rule and never reach `cash`, `item`, `object`, `usage`,
 *   `map` or a `resolve`.
 * - `typed_settle.min_confidence`: the line confidence at or above which such a line settles.
 *
 * Unlike the other budgets it fails closed: a file that cannot be read, or an `admission` entry without a valid class list,
 * settles nothing by the typed reviewer (the lane decides every line), rather than falling back to a shipped list.
 */
export interface AdmissionTypedBudget {
  /** `admission.typed_design`: the typed design every review reads. */
  design: AdmissionTypedDesign;
  /** `admission.typed_settle.classes`: the line classes a typed admission may settle alone. */
  settleClasses: readonly string[];
  /** `admission.typed_settle.min_confidence`: the line confidence, in (0, 1], at or above which such a line settles. */
  settleMinConfidence: number;
}

/** Used when `content/rulesets/coc7/host-budgets.json` cannot be read: the measured design, and no class settles. */
export const ADMISSION_TYPED_FALLBACK: AdmissionTypedBudget = Object.freeze({design: 'roles-2a.3', settleClasses: Object.freeze([]), settleMinConfidence: 0.87});

let admissionTypedCached: Promise<AdmissionTypedBudget> | undefined;

/**
 * The typed admission budget, read once per process and cached like `jevStepsBudget`. `contentRoot` is for tests only;
 * production code always calls this with no argument (the extensions' content root, `PI_COC_CONTENT_ROOT` when relocated).
 */
export function admissionTypedBudget(contentRoot?: string): Promise<AdmissionTypedBudget> {
  if (contentRoot !== undefined) return readAdmissionTypedBudget(contentRoot);
  return admissionTypedCached ??= readAdmissionTypedBudget();
}

async function readAdmissionTypedBudget(contentRoot?: string): Promise<AdmissionTypedBudget> {
  try {
    const raw = JSON.parse(await readFile(join(contentRoot ?? extensionContentRoot(), 'rulesets', 'coc7', 'host-budgets.json'), 'utf8')) as {
      admission?: {typed_design?: unknown; typed_settle?: {classes?: unknown; min_confidence?: unknown}};
    };
    const design = raw.admission?.typed_design, classes = raw.admission?.typed_settle?.classes, min = raw.admission?.typed_settle?.min_confidence;
    return {
      design: typeof design === 'string' && (ADMISSION_TYPED_DESIGNS as readonly string[]).includes(design) ? design as AdmissionTypedDesign : ADMISSION_TYPED_FALLBACK.design,
      settleClasses: Array.isArray(classes) ? Object.freeze([...new Set(classes.filter((value): value is string => typeof value === 'string' && value.length > 0))]) : ADMISSION_TYPED_FALLBACK.settleClasses,
      settleMinConfidence: finite(min) && min > 0 && min <= 1 ? min : ADMISSION_TYPED_FALLBACK.settleMinConfidence,
    };
  } catch {
    return ADMISSION_TYPED_FALLBACK;
  }
}

/** Test-only: forgets the cached value, so a test that swaps the content root sees its own fixture. */
export function resetAdmissionTypedBudgetCache(): void { admissionTypedCached = undefined; }

/**
 * §143.2 (docs/specs/npc-acts-first.md D2): the NPC act generation's named defaults, from the same file's `npc_act`
 * section. `timeoutMs` is the deadline of one whole generation, its one retry included (`runtime/jev/npc-act.ts`).
 * §143.4: `maxPerTurn` is how many people acted on outside a fight act in one turn (the rest are `skipped_cap`).
 * §143.5: `sameActRows` is how many of a person's latest rows the semantic no-repeat question offers.
 */
export interface NpcActBudget {
  timeoutMs: number;
  maxPerTurn: number;
  sameActRows: number;
}

/** Used only if the file or its `npc_act` section cannot be read; the shipped file carries the real default. */
export const NPC_ACT_FALLBACK: NpcActBudget = Object.freeze({timeoutMs: 8000, maxPerTurn: 2, sameActRows: 5});

let npcActCached: Promise<NpcActBudget> | undefined;

/** Read once per process and cached, like `jevStepsBudget`; `contentRoot` is for tests only and is never cached. */
export function npcActBudget(contentRoot?: string): Promise<NpcActBudget> {
  if (contentRoot !== undefined) return readNpcActBudget(contentRoot);
  return npcActCached ??= readNpcActBudget();
}

async function readNpcActBudget(contentRoot?: string): Promise<NpcActBudget> {
  try {
    const raw = JSON.parse(await readFile(join(contentRoot ?? extensionContentRoot(), 'rulesets', 'coc7', 'host-budgets.json'), 'utf8')) as {
      npc_act?: {timeout_ms?: unknown; max_per_turn?: unknown; same_act_rows?: unknown};
    };
    const timeoutMs = raw.npc_act?.timeout_ms, maxPerTurn = raw.npc_act?.max_per_turn, sameActRows = raw.npc_act?.same_act_rows;
    const count = (value: unknown, fallback: number): number => Number.isInteger(value) && (value as number) >= 0 ? value as number : fallback;
    return {timeoutMs: finite(timeoutMs) && timeoutMs > 0 ? timeoutMs : NPC_ACT_FALLBACK.timeoutMs,
      maxPerTurn: count(maxPerTurn, NPC_ACT_FALLBACK.maxPerTurn), sameActRows: count(sameActRows, NPC_ACT_FALLBACK.sameActRows)};
  } catch {
    return NPC_ACT_FALLBACK;
  }
}

/**
 * §145.2 / §145.3: the time reading of a delivery. How long the delivery waits for Jev's reading, the confidence a
 * cut and a day part clear before they ride on the delivery, and the minutes each held cut needs the turn to have
 * moved the clock. Data, not literals in `extensions/kernel/index.ts`: the probe in
 * `docs/specs/keeper-time-skip-tickets.md` set them, and the next table's rows may move them.
 */
export interface TimeReadingBudget {
  /** `time_reading.timeout_ms`: the delivery goes out unread when Jev has not answered by then. */
  timeoutMs: number;
  /** `time_reading.min_confidence`: the gate a cut, and the day part the narration ends in, must clear. */
  minConfidence: number;
  /** `time_reading.floors`: minutes of clock movement the turn needs for each held cut. */
  floors: Readonly<Record<string, number>>;
}

/** Used only if `content/rulesets/coc7/host-budgets.json` cannot be read; the shipped file carries the real values. */
export const TIME_READING_FALLBACK: TimeReadingBudget = Object.freeze({timeoutMs: 2_500, minConfidence: 0.6,
  floors: Object.freeze({later_today: 60, next_day: 240, days: 1440})});

let timeReadingCached: Promise<TimeReadingBudget> | undefined;

/** §145's budget, read once per process and cached. `contentRoot` is for tests only. */
export function timeReadingBudget(contentRoot?: string): Promise<TimeReadingBudget> {
  if (contentRoot !== undefined) return readTimeReadingBudget(contentRoot);
  return timeReadingCached ??= readTimeReadingBudget();
}

async function readTimeReadingBudget(contentRoot?: string): Promise<TimeReadingBudget> {
  try {
    const raw = JSON.parse(await readFile(join(contentRoot ?? extensionContentRoot(), 'rulesets', 'coc7', 'host-budgets.json'), 'utf8')) as {
      time_reading?: {timeout_ms?: unknown; min_confidence?: unknown; floors?: unknown};
    };
    const block = raw.time_reading, timeoutMs = block?.timeout_ms, minConfidence = block?.min_confidence;
    const floors: Record<string, number> = {...TIME_READING_FALLBACK.floors};
    if (block?.floors && typeof block.floors === 'object' && !Array.isArray(block.floors))
      for (const [cut, minutes] of Object.entries(block.floors as Record<string, unknown>))
        if (Object.hasOwn(floors, cut) && finite(minutes) && Number.isInteger(minutes) && minutes >= 0) floors[cut] = minutes;
    return {
      timeoutMs: finite(timeoutMs) && timeoutMs > 0 ? timeoutMs : TIME_READING_FALLBACK.timeoutMs,
      minConfidence: finite(minConfidence) && minConfidence > 0 && minConfidence < 1 ? minConfidence : TIME_READING_FALLBACK.minConfidence,
      floors: Object.freeze(floors),
    };
  } catch {
    return TIME_READING_FALLBACK;
  }
}
