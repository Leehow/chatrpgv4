/**
 * Contract §138.8 (BR-04 of docs/specs/band-then-roll.md, decision D9): the shadow questions for the Keeper's own
 * `time` and `damage` numbers.
 *
 * After a model-origin `apply time {minutes}` or `apply damage {dice}` has landed, the host asks Jev the band question
 * the clerk would ask for that effect (spec D1, D2) and records the answer beside the Keeper's number. Nothing is
 * executed: this module only builds the DecisionBatch over the kernel's own rows and reads the answer. The state is the
 * player's declaration of the turn and what settled before the call -- never the Keeper's `why`, `minutes` or `dice`,
 * so the answer cannot be read off the number it is compared with.
 *
 * Pure: the extension owns the kernel read of the rows, the lease, the scheduling and the telemetry row.
 */
import type {DecisionAnswer, DecisionBatch, DecisionQuestion, DecisionResult, Json, ReadSet, ScopeBinding} from './contracts.ts';
import {ROUTE_TRAVEL_ROWS} from '../../kernel-ts/modules/route-travel.ts';
import {clip, digest16 as digest} from './text.ts';
import type {DecisionPort} from './decision-port.ts';
import type {TaskLease} from './task-context.ts';
import {JEV_MODEL, packDecisionBatch, PackingError} from './question-packing.ts';

export const BAND_SHADOW_FAMILY = 'band-shadow';
/** 2 (§202.2): the time question's criteria are the rows' `covers` and it asks the act's extent. */
export const BAND_SHADOW_VERSION = '2';
export type ShadowKind = 'time' | 'damage';
/** The band field of the registry (§138.2) each shadow kind is about; `rules.bands` answers these. */
export const SHADOW_FIELDS: Readonly<Record<ShadowKind, 'time.band' | 'damage.band'>> = Object.freeze({time: 'time.band', damage: 'damage.band'});
/**
 * The time-cost rows that are a road's time, not an action's (spec D2, D6; §138.2): a move carries the route's
 * minutes, so the per-turn question never offers them. The kernel's one list (§138.9), not a second copy.
 */
export const ROUTE_TIME_BANDS: readonly string[] = ROUTE_TRAVEL_ROWS;
/** Placeholder gate recorded on every row for the report (spec D4): the shadow gates nothing. */
export const BAND_SHADOW_DEFAULT_GATE = 0.5;

/** A time-cost row as `rules.bands` lists it; `covers` (§202.1) is what act the row is and its extent. */
export interface TimeBandRow {handle: string; min: number; max: number; default?: number; covers?: string}
export interface DamageBandRow {handle: string; dice: string; note?: string}
interface ShadowBase {
  campaign: string;
  turn: number;
  /** The settled call and the effect's index in it: one question per effect. */
  callId: string;
  index: number;
  /** The player's declaration of the turn. */
  declaration: string;
  /** What the turn had settled before this call, one line per call, as the host holds it. */
  settled: string[];
}
export type ShadowInput = ShadowBase & ({kind: 'time'; rows: TimeBandRow[]} | {kind: 'damage'; rows: DamageBandRow[]});
export interface ShadowUsage {inputTokens: number; outputTokens: number; costUsd: number}
export interface ShadowAnswered {
  status: 'answered'; kind: ShadowKind;
  /** The argmax row, or null when the argmax is the `unknown` exit. */
  band: string | null; confidence: number; distribution: Record<string, number>;
  /** A Score's probability-weighted level (damage only). */
  score?: number;
  calls: number; elapsedMs: number; usage: ShadowUsage;
}
export interface ShadowFailed {status: 'failed'; kind: ShadowKind; reason: string; calls: number; elapsedMs: number; usage: ShadowUsage}
export type ShadowResult = ShadowAnswered | ShadowFailed;

/** A row handle as words (id syntax, not a reading of any text): `single_room_search` -> `single room search`. */
const words = (handle: string): string => handle.replace(/_+/g, ' ').trim();
const TIME_KEY = 'time_cost', DAMAGE_KEY = 'severity';

/** The lease's and the batch's one binding, from the whole input: the adapter refuses a batch bound differently from its lease. */
export function shadowBindings(input: ShadowInput): {scope: ScopeBinding; readSet: ReadSet} {
  const scope: ScopeBinding = {owner: BAND_SHADOW_FAMILY, campaign: input.campaign, audience: 'keeper'};
  return {scope, readSet: [
    {kind: 'draft', resource: `turn:${input.turn}:band-shadow:${input.kind}:${input.callId}:${input.index}`, revision: digest(input)},
    {kind: 'family', resource: BAND_SHADOW_FAMILY, revision: BAND_SHADOW_VERSION},
    {kind: 'model', resource: `${BAND_SHADOW_FAMILY}:jev`, revision: JEV_MODEL},
  ]};
}

/** The state both questions read: the declaration and what settled before the call. Nothing of the Keeper's own call. */
export function shadowState(input: ShadowBase): Json {
  return {declaration: clip(input.declaration, 600), settled_this_turn: input.settled.slice(-16).map(line => clip(line, 300))};
}

/**
 * A time-cost row as a criterion: its name, its minute range and (§202.2) what act it covers, the row's own words. A row
 * without `covers` (a host fixture; the kernel refuses such a row in the shipped table) keeps its name and range.
 */
export function timeCriterion(row: TimeBandRow): string {
  const covers = typeof row.covers === 'string' ? row.covers.trim() : '';
  return covers ? `${words(row.handle)}, ${row.min} to ${row.max} minutes: ${covers}` : `${words(row.handle)}: ${row.min} to ${row.max} minutes`;
}

/**
 * One Choice over the time-cost categories an action can take (the route rows left out), each criterion the row's
 * name, its minute range and what act it covers, with an `unknown` exit. It asks the act's extent as well as its kind
 * (§202.2): a row of the same kind but a larger or a smaller extent does not fit.
 */
export function timeQuestion(rows: TimeBandRow[]): DecisionQuestion {
  const criteria: Record<string, string> = Object.fromEntries(rows.filter(row => !ROUTE_TIME_BANDS.includes(row.handle))
    .map(row => [row.handle, timeCriterion(row)]));
  criteria.unknown = 'The declaration does not say what the time was spent on, or none of the acts above fits it.';
  return {key: TIME_KEY, target: 'the act the player\'s declared action is, by its kind and its extent, as a cost in time', type: 'choice',
    instructions: 'The player declared an action this turn. Which option is it, judged by what they said they do now and what has already settled this turn? '
      + 'Each option is an act of a given extent with the time it takes at the table. Judge the extent as well as the kind: how much ground the act covers, '
      + 'how many things it goes through, how long one activity goes on. An option of the same kind but a larger extent does not fit (a whole building for '
      + 'one corridor, hours in the holdings for one record brought to hand), nor one of a smaller extent (one room for a search of the whole house). '
      + 'Judge the act itself, not how the story may go on. Choose unknown when the '
      + 'declaration does not say what the time was spent on, or when no option fits it.',
    criteria};
}

/** One Score over the severity ladder in the table's order (lowest first), each level the rung's dice and its rulebook note. */
export function damageQuestion(rows: DamageBandRow[]): DecisionQuestion {
  return {key: DAMAGE_KEY, target: 'how severe the harm this turn dealt is, on the rulebook\'s ladder of damage with no attacker', type: 'score',
    instructions: 'Something in this turn hurt someone without an attacker: a fall, a fire, a falling object, suffocation, a drug, or a failed attempt whose cost was an injury. From what the player declared and what has already settled this turn, how severe is that harm on the rulebook\'s ladder, from a scrape anyone survives many times to near-certain death? Rate the source of the harm, not the toughness of whoever took it.',
    criteria: rows.map(row => `${words(row.handle)}, ${row.dice}${row.note ? `: ${row.note}` : ''}`)};
}

/** The key with the largest probability, the first in the offered order on a tie. */
function argmax(keys: string[], distribution: Record<string, number>): string | undefined {
  let best: string | undefined, top = -Infinity;
  for (const key of keys) {
    const value = distribution[key];
    if (typeof value === 'number' && value > top) { best = key; top = value; }
  }
  return best;
}

function readAnswer(input: ShadowInput, question: DecisionQuestion, answer: DecisionAnswer | undefined):
  Pick<ShadowAnswered, 'band' | 'confidence' | 'distribution' | 'score'> | string {
  if (!answer) return 'no_answer';
  if (answer.status !== 'answered') return `answer_${answer.status}`;
  if (question.type === 'choice' && answer.type === 'choice') {
    const keys = Object.keys(question.criteria);
    const distribution = answer.probabilities ?? {[answer.choice]: 1};
    const top = argmax(keys, distribution) ?? answer.choice;
    return {band: top === 'unknown' ? null : top, confidence: typeof answer.confidence === 'number' ? answer.confidence : 0, distribution};
  }
  if (question.type === 'score' && answer.type === 'score') {
    // A level is its index in the table's order; the row is named by its handle on the record.
    const handles = input.rows.map(row => row.handle);
    const distribution = Object.fromEntries(handles.map((handle, index) => [handle, answer.probabilities[String(index)] ?? 0]));
    return {band: argmax(handles, distribution) ?? null, confidence: answer.confidence, distribution, score: answer.score};
  }
  return 'answer_type';
}

/** Ask the band question for one settled effect. Never throws: every non-answer is a `failed` result with its reason. */
export async function runBandShadow(input: ShadowInput, decision: DecisionPort, lease: TaskLease): Promise<ShadowResult> {
  const began = Date.now(), usage: ShadowUsage = {inputTokens: 0, outputTokens: 0, costUsd: 0};
  let calls = 0;
  const failed = (reason: string): ShadowFailed => ({status: 'failed', kind: input.kind, reason, calls, elapsedMs: Date.now() - began, usage});
  if (!input.rows.length) return failed('no_rows');
  const question = input.kind === 'time' ? timeQuestion(input.rows) : damageQuestion(input.rows);
  const state = shadowState(input), bindings = shadowBindings(input);
  const batch: DecisionBatch = {id: `band-shadow:${input.kind}:${input.turn}:${digest([input.callId, input.index, state])}`, model: JEV_MODEL,
    family: BAND_SHADOW_FAMILY, familyVersion: BAND_SHADOW_VERSION, scope: bindings.scope, readSet: bindings.readSet, state, questions: [question]};
  try {
    packDecisionBatch(batch);
    calls = 1;
    const result: DecisionResult = await decision.decide(batch, lease);
    usage.inputTokens += result.usage?.inputTokens ?? 0;
    usage.outputTokens += result.usage?.outputTokens ?? 0;
    usage.costUsd += result.usage?.costUsd ?? 0;
    const read = readAnswer(input, question, result.answers[question.key]);
    if (typeof read === 'string') return failed(result.failure?.code ?? read);
    return {status: 'answered', kind: input.kind, ...read, calls, elapsedMs: Date.now() - began, usage};
  } catch (error) {
    return failed(error instanceof PackingError ? error.failure : 'shadow_owner_error');
  }
}
