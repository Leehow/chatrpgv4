/**
 * Contract §222.2: the rulebook's ways to a checked clue that the kernel cannot read from receipts, judged by Jev.
 *
 * `apply clue` refuses a clue the book finds by a named skill's check until a route stands (`check_first`, §222.1). Two of
 * the rulebook's routes are semantic -- another skill the investigator's method fits (ch. 5: the Keeper chooses the skill a
 * method uses), and the clue being obvious information the players get without dice (ch. 10, pp. 201-202) -- so the host
 * asks Jev, once per refused clue: one Noul per passed roll of the visit of another skill (`fit_r<n>`), and one Noul for the
 * clue's obviousness (`obvious`). The bars are data (`clue_route` in `host-budgets.json`); the kernel verifies the receipt
 * the host then attests (`found_by`), never the judgement.
 *
 * Pure: the extension owns the kernel reads, the lease, the deadline, the re-sent `apply` and the telemetry row.
 */
import type { DecisionAnswer, DecisionBatch, DecisionQuestion, DecisionResult, Json, ReadSet, ScopeBinding } from './contracts.ts';
import type { DecisionPort } from './decision-port.ts';
import type { ClueRouteBudget } from './host-budgets.ts';
import { JEV_MODEL, packDecisionBatch, PackingError } from './question-packing.ts';
import type { TaskLease } from './task-context.ts';
import { clip, digest16 as digest } from './text.ts';

export const CLUE_ROUTE_FAMILY = 'clue-route';
export const CLUE_ROUTE_VERSION = '1';

/** A passed roll of the visit of another skill than the book's, as the kernel's refusal lists it (`details.routes.other_rolls`). */
export interface ClueRouteRoll { id: string; skill: string; actor: string | null; goal: string | null; turn?: number }
export interface ClueRouteInput {
  campaign: string;
  turn: number;
  /** The player's declaration this turn, when known. */
  declaration: string;
  clue: {
    name: string;
    summary: string;
    /** §135.30.9.2: the book's cues for the clue at this scene (the affordances that grant it). */
    cues: string[];
    /** The book's check for it. */
    check: { skill: string; difficulty?: string };
    /** The conclusions it supports and their authored importance, when the book carries one. */
    supports: Array<{ name: string; importance: string | null }>;
    /** The scene's other undiscovered clues, by summary: what else the scene still offers. */
    others: string[];
  };
  rolls: ClueRouteRoll[];
}
export interface ClueRouteUsage { inputTokens: number; outputTokens: number; costUsd: number }
export interface ClueRouteAnswered {
  status: 'answered';
  /** Each roll's `fit` Noul by receipt id, or null when unanswered. */
  fit: Record<string, number | null>;
  /** The clue's `obvious` Noul, or null when unanswered. */
  obvious: number | null;
  elapsedMs: number;
  usage: ClueRouteUsage;
}
export interface ClueRouteFailed { status: 'failed'; reason: string; elapsedMs: number; usage: ClueRouteUsage }
export type ClueRouteResult = ClueRouteAnswered | ClueRouteFailed;

const rollAlias = (index: number): string => `r${index}`;

export function clueRouteBindings(input: ClueRouteInput): { scope: ScopeBinding; readSet: ReadSet } {
  const scope: ScopeBinding = { owner: CLUE_ROUTE_FAMILY, campaign: input.campaign, audience: 'keeper' };
  return { scope, readSet: [
    { kind: 'draft', resource: `turn:${input.turn}:clue-route:${input.clue.name}`, revision: digest(input) },
    { kind: 'family', resource: CLUE_ROUTE_FAMILY, revision: CLUE_ROUTE_VERSION },
    { kind: 'model', resource: `${CLUE_ROUTE_FAMILY}:jev`, revision: JEV_MODEL },
  ] };
}

/** What every question reads: the clue in the book's words, its book check and cues, the rolls by alias, the scene's other clues. */
export function clueRouteState(input: ClueRouteInput): Json {
  return {
    declaration: clip(input.declaration, 600),
    clue: {
      states: clip(input.clue.summary, 400),
      book_check: `${input.clue.check.skill}${input.clue.check.difficulty ? ` (${input.clue.check.difficulty})` : ''}`,
      book_cues: input.clue.cues.map(cue => clip(cue, 240)),
      supports: input.clue.supports.map(entry => ({ conclusion: entry.name, importance: entry.importance })),
    },
    scene_other_clues: input.clue.others.map(other => clip(other, 160)),
    rolls: Object.fromEntries(input.rolls.map((roll, index) => [rollAlias(index), { skill: roll.skill, actor: roll.actor, goal: roll.goal ? clip(roll.goal, 300) : null }])),
  };
}

const READS = '`clue.states` is one fact of the story in the book\'s own words, which the book has the investigators find by the check '
  + '`clue.book_check`; `clue.book_cues` are the book\'s words for what an investigator does here to get at it. `rolls` are checks that '
  + 'passed on this visit with another skill, each with the goal the roll was made for.';

function fitQuestion(alias: string): DecisionQuestion {
  return { key: `fit_${alias}`, target: `whether the passed roll \`rolls.${alias}\` finds the clue`, type: 'noul',
    instructions: `${READS} Does the method the roll \`rolls.${alias}\` settled -- its skill, used for its goal -- find \`clue.states\`, as the `
      + 'Keeper Rulebook lets the Keeper pick the skill a method uses? Judge whether this roll\'s own method reaches what the book\'s cues '
      + 'describe at this place, not whether the skill is merely relevant or could have been used.',
    criteria: {
      true: { what: 'The roll\'s method, done with its skill for its goal, is a way an investigator gets at this clue here: it reaches the same '
        + 'object, place, person or record the book\'s check reaches, by a skill that fits that method.' },
      false: { not_for: 'A roll made for another purpose or at another thing; a skill the method does not fit; a check that only brought the '
        + 'investigator near the place; or a roll whose goal the book\'s cues do not describe.' },
    } };
}

function obviousQuestion(): DecisionQuestion {
  return { key: 'obvious', target: 'whether the clue is obvious information the scenario needs the investigators to have', type: 'noul',
    instructions: `${READS} The Keeper Rulebook divides clues into obvious ones -- information the Keeper wants the players to have, because `
      + 'missing it would leave them at a loss for how to proceed; the players need no dice for these -- and obscured ones, an advantage the '
      + 'game goes on without. Reading `clue.states`, `clue.supports` (the conclusions it supports, with the book\'s importance when it says one) '
      + 'and `scene_other_clues`, is this clue obvious in that sense -- and does the player\'s `declaration` look where it is? An obvious clue '
      + 'is given without dice to investigators who look in the right place: the declared act reaches the object, place, person or record '
      + 'the book\'s cues describe (asking the right person, opening the right register, searching the right room).',
    criteria: {
      true: { what: 'Without this fact the investigation stalls or loses its direction (a lead, an address, a name or a connection the scenario '
        + 'turns on, or support for a core or critical conclusion no other clue here supplies), and the declared act looks where the book puts it.' },
      false: { not_for: 'A detail, colour, a corroboration of what the investigators already know, an advantage or a shortcut, or a fact the '
        + 'scene\'s other clues also carry; or a declared act that does not look where the book puts it (another thing, another person, '
        + 'merely being nearby).' },
    } };
}

export function clueRouteQuestions(input: ClueRouteInput): DecisionQuestion[] {
  return [...input.rolls.map((_, index) => fitQuestion(rollAlias(index))), obviousQuestion()];
}

function noul(answer: DecisionAnswer | undefined): number | null {
  return answer?.status === 'answered' && answer.type === 'noul' && Number.isFinite(answer.noul) ? answer.noul : null;
}

/** Ask once about one refused clue. Never throws: every non-answer is a `failed` result with its reason. */
export async function runClueRoute(input: ClueRouteInput, decision: DecisionPort, lease: TaskLease): Promise<ClueRouteResult> {
  const began = Date.now(), usage: ClueRouteUsage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
  const failed = (reason: string): ClueRouteFailed => ({ status: 'failed', reason, elapsedMs: Date.now() - began, usage });
  const bindings = clueRouteBindings(input), state = clueRouteState(input);
  try {
    const batch: DecisionBatch = { id: `clue-route:${input.turn}:${digest(state)}`, model: JEV_MODEL, family: CLUE_ROUTE_FAMILY,
      familyVersion: CLUE_ROUTE_VERSION, scope: bindings.scope, readSet: bindings.readSet, state, questions: clueRouteQuestions(input) };
    packDecisionBatch(batch);
    const answered = await decision.decide(batch, lease);
    usage.inputTokens += answered.usage?.inputTokens ?? 0;
    usage.outputTokens += answered.usage?.outputTokens ?? 0;
    usage.costUsd += answered.usage?.costUsd ?? 0;
    const fit = Object.fromEntries(input.rolls.map((roll, index) => [roll.id, noul(answered.answers[`fit_${rollAlias(index)}`])]));
    const obvious = noul(answered.answers.obvious);
    if (obvious === null && !Object.values(fit).some(value => value !== null)) return failed(answered.failure?.code ?? 'no_answer');
    return { status: 'answered', fit, obvious, elapsedMs: Date.now() - began, usage };
  } catch (error) {
    return failed(error instanceof PackingError ? error.failure : 'clue_route_owner_error');
  }
}

/** The `found_by` the host attests, or null; §222.2's order: a fitting roll (the best-scored one) before obviousness. */
export type ClueRouteChoice = { route: 'fitting_check'; roll: string; score: number } | { route: 'obvious'; score: number } | null;
export function clueRouteDecision(result: ClueRouteResult, budget: Pick<ClueRouteBudget, 'fitMin' | 'obviousMin'>): ClueRouteChoice {
  if (result.status !== 'answered') return null;
  const fits = Object.entries(result.fit).filter((entry): entry is [string, number] => entry[1] !== null && entry[1] >= budget.fitMin)
    .sort((a, b) => b[1] - a[1]);
  if (fits.length) return { route: 'fitting_check', roll: fits[0]![0], score: fits[0]![1] };
  if (result.obvious !== null && result.obvious >= budget.obviousMin) return { route: 'obvious', score: result.obvious };
  return null;
}
