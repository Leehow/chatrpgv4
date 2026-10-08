/**
 * Contract §203.6: the establishing check, beside §166.2's refused-document boundary on every delivery path.
 *
 * A turn owes an establishing reply when the party stands in a place this table has not established, or the Keeper looked
 * the place over (§203.2). Before such a draft is delivered, the review lane judges it against the rows the prose package
 * says establishing owes. A thin draft is steered once -- the caller holds it and hands the fix to the Keeper through the
 * existing one-steer machinery -- and whatever comes next is delivered. No loop: the next delivery of the turn is not
 * judged before it lands; a steered one is judged once afterwards, in the background, for the record.
 *
 * This module decides and records; it never touches the table state machine. `extensions/kernel/index.ts` owns the
 * draft, the steer and the refusal.
 */
import type {EstablishReviewPort, EstablishReviewResult} from '../../runtime/jev/establish-review.ts';

type Row = Record<string, unknown>;
const object = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const text = (value: unknown): string => typeof value === 'string' ? value : '';

export const ESTABLISH_LANE = 'establish';
/** The review never runs with less than this left before the turn's provider deadline; it keeps this much back. */
export const ESTABLISH_MIN_MS = 6000, ESTABLISH_RESERVE_MS = 4000, ESTABLISH_TIMEOUT_MS = 20000;

export type EstablishPath = 'explicit' | 'embedded' | 'implicit';
export interface EstablishItem {place: {id: string; name: string}; why: string[]; owes: Array<{key: string; line: string}>; package?: Row}
/** What the delivery record keeps of the check (`establish_review`, host-only, outside the call digest). */
export interface EstablishReviewNote {status: 'pass' | 'thin' | 'steered' | 'unavailable' | 'skipped'; missing?: string[]; steered?: boolean; look?: boolean}
export type EstablishOutcome =
  | {status: 'skipped'; reason: string; note?: EstablishReviewNote}
  | {status: 'pass'; note: EstablishReviewNote}
  | {status: 'unavailable'; reason: string; note: EstablishReviewNote}
  | {status: 'thin'; item: EstablishItem; missing: string[]; fix: string; note: EstablishReviewNote; instruction: string; present: string[]; era: string | null};

export interface EstablishGuardInput {
  campaign: string;
  turn: number;
  draft: string;
  path: EstablishPath;
  /** The Keeper looked the place over this turn (§203.4). */
  look: boolean;
  signal: AbortSignal;
  deadlineAt?: number;
}
export interface EstablishGuardDeps {
  /** A read-only kernel call on the table's campaign. */
  view(params: {look: boolean}): Promise<Row>;
  lane: EstablishReviewPort;
  record(row: Row): void | Promise<void>;
  now?: () => number;
}

/** The item as the view returns it, or undefined when the view carries none. */
export function establishItemOf(view: Row): EstablishItem | undefined {
  const item = object(view.establish), place = object(item.place);
  const owes = Array.isArray(item.owes) ? (item.owes as unknown[]).map(object).filter(owe => text(owe.key) && text(owe.line))
    .map(owe => ({key: text(owe.key), line: text(owe.line)})) : [];
  if (!text(place.id) || !owes.length) return undefined;
  return {place: {id: text(place.id), name: text(place.name) || text(place.id)}, why: Array.isArray(item.why) ? (item.why as unknown[]).map(text).filter(Boolean) : [],
    owes, ...(item.package ? {package: object(item.package)} : {})};
}

/**
 * The one steer's text: the place, why it is owed, what the draft did not establish (the package's own lines), and what
 * must not move. Host-owned English (Agents.md: system language).
 */
export function establishFix(item: EstablishItem, missing: readonly string[]): string {
  const lines = item.owes.filter(owe => missing.includes(owe.key)).map(owe => `${owe.key}: ${owe.line}`);
  const why = item.why.includes('look') && item.why.length === 1 ? 'the investigator is looking it over'
    : item.why.includes('opening') ? 'it opens the table' : 'the investigator has just come into it and it has not been established';
  return `This reply was not delivered yet. It is at ${item.place.name}, and ${why}, so it establishes the place (mods.establish). `
    + `The draft does not yet establish: ${lines.join('; ')}. Write the whole reply again in the play language: keep the player's act, `
    + 'every settled result and every line already spoken as they are, and establish the place along the eye\'s path before the '
    + 'turn\'s business, as the prose package\'s Establishing a place says. Invent nothing that changes the books. Deliver it once with narrate '
    + '(or ask, for a pending choice).';
}

/**
 * The check for one draft. Never throws: a kernel read that fails, a lane that fails or a deadline too near deliver the
 * draft (`skipped` / `unavailable`), and the caller goes on. `thin` is the only outcome that holds the draft.
 */
export async function checkEstablish(input: EstablishGuardInput, deps: EstablishGuardDeps): Promise<EstablishOutcome> {
  const now = deps.now ?? Date.now, row = (fields: Row) => deps.record({lane: ESTABLISH_LANE, turn: input.turn, path: input.path, ...fields});
  // An ask with no prose of its own (a mechanics choice the frontend draws) has nothing to judge.
  if (!input.draft.trim()) return {status: 'skipped', reason: 'no_prose'};
  let view: Row;
  try { view = await deps.view({look: input.look}); }
  catch (error) {
    await row({event: 'skipped', reason: 'view_unavailable', detail: String((error as Error)?.message ?? error).slice(0, 160)});
    return {status: 'skipped', reason: 'view_unavailable'};
  }
  const item = establishItemOf(view);
  if (!item) return {status: 'skipped', reason: 'not_owed'};
  const note = (status: EstablishReviewNote['status'], extra: Partial<EstablishReviewNote> = {}): EstablishReviewNote =>
    ({status, ...(input.look ? {look: true} : {}), ...extra});
  await row({event: 'due', scene: item.place.id, why: item.why});
  const review = object(view.review), instruction = text(review.instruction);
  if (!instruction) {
    await row({event: 'skipped', scene: item.place.id, reason: Array.isArray(view.contributors) ? 'review_contested' : 'no_review'});
    return {status: 'skipped', reason: 'no_review', note: note('skipped')};
  }
  const remaining = input.deadlineAt === undefined ? Infinity : input.deadlineAt - now();
  if (remaining < ESTABLISH_MIN_MS) {
    await row({event: 'skipped', scene: item.place.id, reason: 'budget', remaining_ms: Math.max(0, Math.round(remaining))});
    return {status: 'skipped', reason: 'budget', note: note('skipped')};
  }
  const timeoutMs = Math.max(1000, Math.min(ESTABLISH_TIMEOUT_MS, remaining - ESTABLISH_RESERVE_MS));
  const present = Array.isArray(view.present) ? (view.present as unknown[]).map(text).filter(Boolean) : [], era = text(view.era) || null;
  const result: EstablishReviewResult = await deps.lane.review({turn: input.turn, prose: input.draft, place: item.place, why: item.why,
    present, era, owes: item.owes}, {instruction, signal: input.signal, timeoutMs});
  if (!result.ok) {
    await row({event: 'unavailable', scene: item.place.id, reason: result.reason, ms: result.ms, model: result.model ?? null});
    return {status: 'unavailable', reason: result.reason, note: note('unavailable')};
  }
  await row({event: 'judged', scene: item.place.id, ms: result.ms, model: result.model ?? null, verdict: result.thin ? 'thin' : 'pass',
    missing: result.missing, unanchored: result.unanchored, shown: result.shown});
  if (!result.thin) return {status: 'pass', note: note('pass')};
  return {status: 'thin', item, missing: result.missing, fix: establishFix(item, result.missing), note: note('thin', {missing: result.missing}),
    instruction, present, era};
}

/**
 * After a steered delivery lands: the review judges what the player actually got, once, in the background, for the
 * record (`event: "after_steer"`). Never awaited by the delivery; never throws.
 */
export function judgeAfterSteer(input: {campaign: string; turn: number; prose: string; item: EstablishItem; instruction: string; present: string[]; era: string | null; signal: AbortSignal},
  deps: Pick<EstablishGuardDeps, 'lane' | 'record'>): void {
  setTimeout(() => {
    void (async () => {
      try {
        const result = await deps.lane.review({turn: input.turn, prose: input.prose, place: input.item.place, why: input.item.why, present: input.present,
          era: input.era, owes: input.item.owes}, {instruction: input.instruction, signal: input.signal, timeoutMs: ESTABLISH_TIMEOUT_MS * 3});
        await deps.record(result.ok
          ? {lane: ESTABLISH_LANE, event: 'after_steer', turn: input.turn, scene: input.item.place.id, verdict: result.thin ? 'thin' : 'pass',
            missing: result.missing, unanchored: result.unanchored, ms: result.ms, model: result.model ?? null}
          : {lane: ESTABLISH_LANE, event: 'after_steer', turn: input.turn, scene: input.item.place.id, verdict: 'unavailable', reason: result.reason});
      } catch { /* the record is best effort */ }
    })();
  }, 0);
}
