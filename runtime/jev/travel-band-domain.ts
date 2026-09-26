/**
 * Contract §138.9 (BR-05 of docs/specs/band-then-roll.md): the build-time question that names the length of a road.
 *
 * Every `route-to` road of a module graph that carries no `travel_minutes` is asked once, at build, as one Choice
 * over the travel rows of `time-costs` (`local_travel`, `long_travel`) plus the exit `adjacent` (two parts of one
 * building or one place: no road, no clock). The state is the two scenes as the book describes them -- names,
 * summaries, places -- and never anything the table does at play. The questions of one build are fanned out, one
 * Choice per road, in as few requests as the packing limit and the routes-per-request cap allow.
 *
 * Pure: builds DecisionBatches and reads their answers. Jev names a row; the kernel's one writer
 * (`kernel-ts/modules/route-travel.ts`) turns it into the row's `default` (never a roll: the same road is the same
 * length every time). The host glue owns the adapter, the lease, the telemetry and the write.
 */
import {createHash} from 'node:crypto';
import type {DecisionBatch, DecisionQuestion, DecisionResult, Json, ReadSet, ScopeBinding} from './contracts.ts';
import type {DecisionPort} from './decision-port.ts';
import type {TaskLease} from './task-context.ts';
import {JEV_MODEL, packDecisionBatch, PackingError} from './question-packing.ts';
import {TRAVEL_ADJACENT} from '../../kernel-ts/modules/route-travel.ts';

export const TRAVEL_FILL_FAMILY = 'travel-fill';
export const TRAVEL_FILL_VERSION = '1';
/** A placeholder gate until the fill's own rows calibrate it (spec D4, Further Notes): low enough to measure. */
export const TRAVEL_DEFAULT_MIN_CONFIDENCE = 0.5;
/**
 * How many roads one request carries at most, below the packing limit. Every question of a request reads the one
 * shared state, and a large state of other roads is the skill's "large irrelevant state" failure: a small cap keeps
 * each question's distractors few while the fan-out still spends one request on many roads.
 */
export const TRAVEL_ROADS_PER_REQUEST = 12;

/** A scene as the book describes it: what the question reads, never a handle or an internal id. */
export interface SceneBrief {name: string; summary?: string; places?: string[]; tags?: string[]}
/** One road to ask: the two scene node ids (order free) and their briefs. */
export interface TravelRoad {a: string; b: string; briefs: [SceneBrief, SceneBrief]}
/** A travel row of the time-cost table: the criterion's text is its own name and range. */
export interface TravelBandRow {handle: string; min?: number; max?: number; default?: number}
export interface TravelBandInput {module: string; campaign?: string; roads: TravelRoad[]; rows: readonly TravelBandRow[]}
export interface TravelUsage {inputTokens: number; outputTokens: number; costUsd: number}
/** What the fill does with one road: `banded` writes the band, every other outcome leaves the road as it is. */
export type TravelOutcome = 'banded' | 'low_confidence' | 'no_answer';
export interface TravelAnswer {
  a: string; b: string; outcome: TravelOutcome;
  band?: string; confidence?: number; distribution?: Record<string, number>; reason?: string;
}
export interface TravelBandResult {answers: TravelAnswer[]; calls: number; elapsedMs: number; usage: TravelUsage}

const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
const clip = (value: string, max: number): string => Array.from(value).length <= max ? value : Array.from(value).slice(0, max - 3).join('') + '...';

/** The one binding of a build's questions: the lease and every batch carry it, or the adapter refuses the batch. */
export function travelBindings(input: TravelBandInput): {scope: ScopeBinding; readSet: ReadSet} {
  const scope: ScopeBinding = {owner: TRAVEL_FILL_FAMILY, ...(input.campaign ? {campaign: input.campaign} : {}), audience: 'keeper'};
  return {scope, readSet: [
    {kind: 'draft', resource: `module:${input.module}:travel`, revision: digest({roads: input.roads, rows: input.rows})},
    {kind: 'family', resource: TRAVEL_FILL_FAMILY, revision: TRAVEL_FILL_VERSION},
    {kind: 'model', resource: `${TRAVEL_FILL_FAMILY}:jev`, revision: JEV_MODEL},
  ]};
}

function briefState(brief: SceneBrief): Json {
  return {name: clip(brief.name, 160),
    ...(brief.summary ? {summary: clip(brief.summary, 480)} : {}),
    ...(brief.places?.length ? {places: brief.places.slice(0, 6).map(place => clip(place, 120))} : {}),
    ...(brief.tags?.length ? {place_words: brief.tags.slice(0, 10).map(tag => clip(tag, 60))} : {})};
}

/** The criteria: the exit, then each travel row by its own name and range, in the table's order. */
export function travelCriteria(rows: readonly TravelBandRow[]): Record<string, string> {
  const criteria: Record<string, string> = {
    [TRAVEL_ADJACENT]: 'adjacent: the two scenes are parts of one building or one place, so there is no road between them and no clock runs on the way.',
  };
  for (const row of rows)
    criteria[row.handle] = `${row.handle.replaceAll('_', ' ')}: ${row.min} to ${row.max} minutes on the way between the two.`;
  return criteria;
}

const INSTRUCTIONS = (key: string) => `\`roads.${key}\` holds two scenes of one scenario, \`a\` and \`b\`, each with its name, its summary and, where the book gives them, its places and place words. How long is the way from one to the other for people travelling between them in the story's world? Judge where the two scenes are, not what happens in them. Choose adjacent when both are parts of one building or one place (rooms, floors, a cellar and the house above it, a yard and its house). Choose local travel for two places of one town or city, or just outside it. Choose long travel for places in different towns, or somewhere far out of one.`;

function questionFor(key: string, road: TravelRoad, criteria: Record<string, string>): DecisionQuestion {
  return {key, target: clip(`the way between ${road.briefs[0].name} and ${road.briefs[1].name}`, 240), type: 'choice',
    instructions: INSTRUCTIONS(key), criteria};
}

function batchOf(input: TravelBandInput, bindings: {scope: ScopeBinding; readSet: ReadSet}, roads: TravelRoad[], criteria: Record<string, string>, ordinal: number): DecisionBatch {
  const keyed = roads.map((road, index) => [`road_${index + 1}`, road] as const);
  const state: Json = {roads: Object.fromEntries(keyed.map(([key, road]) => [key, {a: briefState(road.briefs[0]), b: briefState(road.briefs[1])}]))};
  return {id: `travel:${input.module}:${ordinal}:${digest(state)}`, model: JEV_MODEL, family: TRAVEL_FILL_FAMILY, familyVersion: TRAVEL_FILL_VERSION,
    scope: bindings.scope, readSet: bindings.readSet, state, questions: keyed.map(([key, road]) => questionFor(key, road, criteria))};
}

/**
 * The build's requests: roads in order, a request closed when the cap is reached or the next road would break the
 * packing limit. A road too large for a request of its own is left out and answered `no_answer: packing_limit`.
 */
export function travelBatches(input: TravelBandInput): {batches: Array<{batch: DecisionBatch; roads: TravelRoad[]}>; unpacked: TravelRoad[]} {
  const bindings = travelBindings(input), criteria = travelCriteria(input.rows);
  const batches: Array<{batch: DecisionBatch; roads: TravelRoad[]}> = [], unpacked: TravelRoad[] = [];
  let current: TravelRoad[] = [];
  const fits = (roads: TravelRoad[]): boolean => {
    try { packDecisionBatch(batchOf(input, bindings, roads, criteria, batches.length)); return true; }
    catch (error) { if (error instanceof PackingError) return false; throw error; }
  };
  const close = () => { if (current.length) batches.push({batch: batchOf(input, bindings, current, criteria, batches.length), roads: current}); current = []; };
  for (const road of input.roads) {
    if (current.length >= TRAVEL_ROADS_PER_REQUEST) close();
    if (fits([...current, road])) { current.push(road); continue; }
    close();
    if (fits([road])) current.push(road);
    else unpacked.push(road);
  }
  close();
  return {batches, unpacked};
}

function answerOf(result: DecisionResult, key: string, criteria: Record<string, string>): {choice: string; confidence: number; distribution: Record<string, number>} | undefined {
  const answer = result.answers[key];
  if (!answer || answer.status !== 'answered' || answer.type !== 'choice' || !Object.hasOwn(criteria, answer.choice)) return undefined;
  return {choice: answer.choice, confidence: typeof answer.confidence === 'number' ? answer.confidence : 0,
    distribution: answer.probabilities ?? {[answer.choice]: 1}};
}

/**
 * Ask every road, fanned out, and read each answer against the gate. A road is `banded` only when its answer is a
 * criterion of the question and its confidence is at or above `minConfidence`; below the gate, on a failed request,
 * or on a road the packing limit left out, the road keeps no minutes and the answer says why.
 */
export async function runTravelBands(input: TravelBandInput, decision: DecisionPort, lease: TaskLease,
  options: {minConfidence: number}): Promise<TravelBandResult> {
  const began = Date.now(), usage: TravelUsage = {inputTokens: 0, outputTokens: 0, costUsd: 0};
  const criteria = travelCriteria(input.rows);
  const {batches, unpacked} = travelBatches(input);
  const answers: TravelAnswer[] = unpacked.map(road => ({a: road.a, b: road.b, outcome: 'no_answer', reason: 'packing_limit'}));
  let calls = 0;
  const settled = await Promise.all(batches.map(async ({batch, roads}) => {
    let result: DecisionResult | undefined, failure = 'band_owner_error';
    try { result = await decision.decide(batch, lease); if ((result.attempts ?? 1) > 0) calls++; }
    catch (error) { failure = error instanceof PackingError ? error.failure : 'band_owner_error'; }
    if (result) {
      usage.inputTokens += result.usage?.inputTokens ?? 0;
      usage.outputTokens += result.usage?.outputTokens ?? 0;
      usage.costUsd += result.usage?.costUsd ?? 0;
    }
    return roads.map((road, index): TravelAnswer => {
      const answer = result ? answerOf(result, `road_${index + 1}`, criteria) : undefined;
      if (!answer) return {a: road.a, b: road.b, outcome: 'no_answer', reason: result?.failure?.code ?? (result ? 'no_answer' : failure)};
      const row = {band: answer.choice, confidence: answer.confidence, distribution: answer.distribution};
      return answer.confidence >= options.minConfidence
        ? {a: road.a, b: road.b, outcome: 'banded', ...row}
        : {a: road.a, b: road.b, outcome: 'low_confidence', ...row};
    });
  }));
  return {answers: [...settled.flat(), ...answers], calls, elapsedMs: Date.now() - began, usage};
}
