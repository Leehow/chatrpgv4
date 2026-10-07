/**
 * Contract §187.2.3: the host's placement of a place the Keeper is about to mint.
 *
 * A `move` effect that carries `establish` describes a destination the graph does not hold by that name. Before the
 * kernel mints it, the host asks Jev, over book places the kernel enumerated (`table.apply.placement`: the active scene,
 * its exits, the book places of the reading window) and a `none` exit, which place the described destination is or lies
 * inside (one Choice), and for each candidate whether the destination is that place itself (`same`, a Noul) or a smaller
 * place within it (`inside`, a Noul) -- one request, fanned out. The state is the effect's `to`, `via` and
 * `establish.summary`, the active scene's name and summary, and the candidates' names, aliases and one-line summaries;
 * nothing else. No name is compared with any other here: the lane decides on the description.
 *
 * Pure: the extension owns the kernel read, the lease, the deadline, the rewrite and the telemetry row.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DecisionAnswer, DecisionBatch, DecisionQuestion, DecisionResult, Json, ReadSet, ScopeBinding } from './contracts.ts';
import type { DecisionPort } from './decision-port.ts';
import type { TaskLease } from './task-context.ts';
import { JEV_MODEL, packDecisionBatch, PackingError } from './question-packing.ts';
import { clip, digest16 as digest } from './text.ts';
import { extensionContentRoot } from '../../extensions/ui/words.ts';

export const SCENE_PLACEMENT_FAMILY = 'scene-placement';
export const SCENE_PLACEMENT_VERSION = '1';

/** `host-budgets.json` `scene_placement`: the lane's mode and its bars (data, calibrated from shadow rows, §187.2.3). */
export interface ScenePlacementBudget {
  /** `off`: never asked; `shadow`: asked and recorded, the effect unchanged; `on`: the outcome rewrites the effect. */
  mode: 'off' | 'shadow' | 'on';
  /** The `same` Noul a chosen candidate must reach for the move to go to that place instead of minting it. */
  sameMin: number;
  /** The `inside` Noul a chosen candidate must reach for the mint to carry `within: <candidate>`. */
  insideMin: number;
  /** The `place` Choice's confidence below which nothing is placed. */
  choiceConfidenceMin: number;
  /** How many book places the kernel is asked for (1..64). */
  maxCandidates: number;
  /** How long an `on` placement may hold the move before it goes through as written. */
  timeoutMs: number;
}

/** Used only if the file or its `scene_placement` section cannot be read; the shipped file carries the real values. */
export const SCENE_PLACEMENT_FALLBACK: ScenePlacementBudget = Object.freeze({mode: 'shadow', sameMin: 0.8, insideMin: 0.75,
  choiceConfidenceMin: 0.5, maxCandidates: 24, timeoutMs: 2500});

let cached: Promise<ScenePlacementBudget> | undefined;

/** Read once per process and cached; `contentRoot` is for tests only and is never cached. */
export function scenePlacementBudget(contentRoot?: string): Promise<ScenePlacementBudget> {
  if (contentRoot !== undefined) return readBudget(contentRoot);
  return cached ??= readBudget();
}
export function resetScenePlacementBudgetCache(): void { cached = undefined; }

async function readBudget(contentRoot?: string): Promise<ScenePlacementBudget> {
  try {
    const raw = JSON.parse(await readFile(join(contentRoot ?? extensionContentRoot(), 'rulesets', 'coc7', 'host-budgets.json'), 'utf8')) as {scene_placement?: Record<string, unknown>};
    const block = raw.scene_placement ?? {}, fallback = SCENE_PLACEMENT_FALLBACK;
    const bar = (value: unknown, otherwise: number): number => typeof value === 'number' && value > 0 && value <= 1 ? value : otherwise;
    const mode = ['off', 'shadow', 'on'].includes(String(block.mode)) ? block.mode as ScenePlacementBudget['mode'] : fallback.mode;
    const max = block.max_candidates, timeout = block.timeout_ms;
    return {mode, sameMin: bar(block.same_min, fallback.sameMin), insideMin: bar(block.inside_min, fallback.insideMin),
      choiceConfidenceMin: bar(block.choice_confidence_min, fallback.choiceConfidenceMin),
      maxCandidates: Number.isInteger(max) && (max as number) >= 1 && (max as number) <= 64 ? max as number : fallback.maxCandidates,
      timeoutMs: typeof timeout === 'number' && Number.isFinite(timeout) && timeout > 0 ? timeout : fallback.timeoutMs};
  } catch {
    return SCENE_PLACEMENT_FALLBACK;
  }
}

/** One book place as `table.apply.placement` lists it. */
export interface PlacementCandidate {name: string; display_name?: string; aliases?: string[]; summary: string; source: 'here' | 'exit' | 'window'}
export interface PlacementInput {
  campaign: string;
  turn: number;
  /** The `apply` call and the effect's index in it: one placement per effect. */
  callId: string;
  index: number;
  to: string;
  via: string;
  summary: string;
  scene: {name: string; display_name?: string; summary: string};
  candidates: PlacementCandidate[];
}
export interface PlacementUsage {inputTokens: number; outputTokens: number; costUsd: number}
export interface PlacementAnswered {
  status: 'answered';
  /** The candidate the Choice put first, or null when that is `none`. */
  chosen: string | null;
  confidence: number;
  /** The Choice's distribution over candidate handles and `none`. */
  distribution: Record<string, number>;
  /** The two Nouls per candidate handle. */
  same: Record<string, number>;
  inside: Record<string, number>;
  elapsedMs: number;
  usage: PlacementUsage;
}
export interface PlacementFailed {status: 'failed'; reason: string; elapsedMs: number; usage: PlacementUsage}
export type PlacementResult = PlacementAnswered | PlacementFailed;

/** The candidates' aliases on the wire (`c0`, `c1`, ...): handles are file names, and a key is not a name. */
const alias = (index: number): string => `c${index}`;

export function placementBindings(input: PlacementInput): {scope: ScopeBinding; readSet: ReadSet} {
  const scope: ScopeBinding = {owner: SCENE_PLACEMENT_FAMILY, campaign: input.campaign, audience: 'keeper'};
  return {scope, readSet: [
    {kind: 'draft', resource: `turn:${input.turn}:scene-placement:${input.callId}:${input.index}`, revision: digest(input)},
    {kind: 'family', resource: SCENE_PLACEMENT_FAMILY, revision: SCENE_PLACEMENT_VERSION},
    {kind: 'model', resource: `${SCENE_PLACEMENT_FAMILY}:jev`, revision: JEV_MODEL},
  ]};
}

/** What every question reads: the described destination, where the party stands, and the book places, by alias. */
export function placementState(input: PlacementInput): Json {
  return {
    destination: {name: clip(input.to, 200), route: clip(input.via, 300), description: clip(input.summary, 600)},
    party_is_at: {name: input.scene.display_name ?? input.scene.name, summary: clip(input.scene.summary, 300)},
    book_places: Object.fromEntries(input.candidates.map((candidate, index) => [alias(index), {
      name: candidate.display_name ?? candidate.name, ...(candidate.aliases?.length ? {also_called: candidate.aliases} : {}),
      summary: clip(candidate.summary, 160)}])),
  };
}

/** The Choice and the two Nouls per candidate, in one batch. */
export function placementQuestions(input: PlacementInput): DecisionQuestion[] {
  const criteria: Record<string, string> = Object.fromEntries(input.candidates.map((candidate, index) =>
    [alias(index), `${candidate.display_name ?? candidate.name}: the book place \`book_places.${alias(index)}\``]));
  criteria.none = 'The described destination is none of these book places and lies inside none of them.';
  const questions: DecisionQuestion[] = [{key: 'place', target: 'the book place the described destination is, or lies inside', type: 'choice',
    instructions: 'The Keeper is about to add a new place to the story: `destination` gives the name the Keeper used, the route there and the description. `book_places` are places the book already describes. Which book place is the destination, or which book place is it inside? Judge by what the description says the destination is and where it is, not by a word the names share. Choose none when the destination is a different place from all of them and lies inside none of them.',
    criteria}];
  input.candidates.forEach((candidate, index) => {
    const name = candidate.display_name ?? candidate.name;
    questions.push({key: `same_${alias(index)}`, target: `whether the destination is ${name} itself`, type: 'noul',
      instructions: `Is the described destination (\`destination\`) the book place \`book_places.${alias(index)}\` (${name}) itself -- the same place under another name, or the whole of it -- rather than a different place or one smaller part of it?`});
    questions.push({key: `inside_${alias(index)}`, target: `whether the destination lies inside ${name}`, type: 'noul',
      instructions: `Is the described destination (\`destination\`) a smaller place within the book place \`book_places.${alias(index)}\` (${name}) -- a room, a corner, a building or a spot inside it -- and not the whole of that place?`});
  });
  return questions;
}

function noul(answer: DecisionAnswer | undefined): number | undefined {
  return answer?.status === 'answered' && answer.type === 'noul' && Number.isFinite(answer.noul) ? answer.noul : undefined;
}

/** Ask the placement questions for one effect. Never throws: every non-answer is a `failed` result with its reason. */
export async function runScenePlacement(input: PlacementInput, decision: DecisionPort, lease: TaskLease): Promise<PlacementResult> {
  const began = Date.now(), usage: PlacementUsage = {inputTokens: 0, outputTokens: 0, costUsd: 0};
  const failed = (reason: string): PlacementFailed => ({status: 'failed', reason, elapsedMs: Date.now() - began, usage});
  if (!input.candidates.length) return failed('no_candidates');
  const bindings = placementBindings(input), state = placementState(input);
  const batch: DecisionBatch = {id: `scene-placement:${input.turn}:${digest([input.callId, input.index, state])}`, model: JEV_MODEL,
    family: SCENE_PLACEMENT_FAMILY, familyVersion: SCENE_PLACEMENT_VERSION, scope: bindings.scope, readSet: bindings.readSet, state,
    questions: placementQuestions(input)};
  try {
    packDecisionBatch(batch);
    const result: DecisionResult = await decision.decide(batch, lease);
    usage.inputTokens += result.usage?.inputTokens ?? 0;
    usage.outputTokens += result.usage?.outputTokens ?? 0;
    usage.costUsd += result.usage?.costUsd ?? 0;
    const place = result.answers.place;
    if (!place || place.status !== 'answered' || place.type !== 'choice') return failed(result.failure?.code ?? 'no_answer');
    const keys = [...input.candidates.map((_, index) => alias(index)), 'none'];
    const handle = (key: string): string => key === 'none' ? 'none' : input.candidates[Number(key.slice(1))]!.name;
    const probabilities = place.probabilities ?? {[place.choice]: 1};
    let top = keys.includes(place.choice) ? place.choice : 'none';
    for (const key of keys) if ((probabilities[key] ?? 0) > (probabilities[top] ?? 0)) top = key;
    const distribution = Object.fromEntries(keys.map(key => [handle(key), probabilities[key] ?? 0]));
    const same: Record<string, number> = {}, inside: Record<string, number> = {};
    input.candidates.forEach((candidate, index) => {
      const s = noul(result.answers[`same_${alias(index)}`]), i = noul(result.answers[`inside_${alias(index)}`]);
      if (s !== undefined) same[candidate.name] = s;
      if (i !== undefined) inside[candidate.name] = i;
    });
    return {status: 'answered', chosen: top === 'none' ? null : handle(top), confidence: typeof place.confidence === 'number' ? place.confidence : 0,
      distribution, same, inside, elapsedMs: Date.now() - began, usage};
  } catch (error) {
    return failed(error instanceof PackingError ? error.failure : 'placement_owner_error');
  }
}

export type PlacementOutcome = {outcome: 'same'; handle: string} | {outcome: 'inside'; handle: string} | {outcome: 'mint'; reason: string};

/**
 * The outcome the bars give: `same` when the chosen candidate's `same` clears `sameMin`, else `inside` when its `inside`
 * clears `insideMin`, else `mint`. The active scene is never `same`: a move to where the party stands is no move, so
 * for it only `inside` applies. A failed or low-confidence answer, and `none`, mint as written.
 */
export function placementOutcome(result: PlacementResult, budget: ScenePlacementBudget, activeScene: string): PlacementOutcome {
  if (result.status !== 'answered') return {outcome: 'mint', reason: result.reason};
  if (result.chosen === null) return {outcome: 'mint', reason: 'none'};
  if (result.confidence < budget.choiceConfidenceMin) return {outcome: 'mint', reason: 'low_confidence'};
  if (result.chosen !== activeScene && (result.same[result.chosen] ?? 0) >= budget.sameMin) return {outcome: 'same', handle: result.chosen};
  if ((result.inside[result.chosen] ?? 0) >= budget.insideMin) return {outcome: 'inside', handle: result.chosen};
  return {outcome: 'mint', reason: 'below_bar'};
}

/**
 * The effect the outcome sends: `same` is a move to the book place with `establish` dropped and `via` (and every other
 * field) kept; `inside` adds `within` to `establish`; `mint` is the effect as written.
 */
export function placedEffect(effect: Record<string, unknown>, outcome: PlacementOutcome): Record<string, unknown> {
  if (outcome.outcome === 'same') {
    const {establish: _establish, ...rest} = effect;
    return {...rest, to: outcome.handle};
  }
  if (outcome.outcome === 'inside')
    return {...effect, establish: {...(effect.establish as Record<string, unknown>), within: outcome.handle}};
  return effect;
}
