/**
 * §163 (owner ruling 2026-10-01): a Jev decision that stays uncertain, unanswered or unavailable still resolves to a
 * concrete result. The host takes Jev's own best-scored option, or, with nothing executable or scored, the no-roll path
 * where the Keeper narrates by judgement; an unsettled interaction scope plays as a world turn. Every such result is a
 * forced resolution: one telemetry row (`lane: "forced-resolution"`) and one line the Keeper sees on that turn.
 */
import {createHash} from 'node:crypto';
import type {DecisionBatch, DecisionResult, Json, ReadSet, ScopeBinding} from './contracts.ts';
import {JEV_MODEL} from './question-packing.ts';

/** Which decision was forced. Closed: each family names one owner of a §163 path. */
export type ForcedFamily = 'interaction-scope' | 'check-selection' | 'check-binding' | 'check-execution' | 'check-preparation';
export type ForcedOutcome = 'inspect_check' | 'roll' | 'no_roll' | 'deferred' | 'world';
/** Why the decision was forced: a gate Jev answered below, no answer at all, or no executable option. */
export type ForcedWhy = 'below_confidence_gate' | 'jev_unanswered' | 'nothing_executable' | 'check_refused' | 'preparation_incomplete' | 'player_choice';
export interface ForcedResolution {
  /** Stable identity inside one run: the row is recorded once and the Keeper is told once. */
  key: string;
  family: ForcedFamily;
  /** What was being decided: a check's label, a rule decision, or the player's message. */
  subject: string;
  /** What Jev could not settle, with the scores it gave when it gave any. */
  uncertain: string[];
  chosen: {outcome: ForcedOutcome; check?: string; action?: Json};
  why: string;
}

export function forcedResolution(entry: Omit<ForcedResolution, 'key'>, salt: Json = null): ForcedResolution {
  return {key: createHash('sha256').update(JSON.stringify([entry.family, entry.subject, entry.chosen.outcome, salt])).digest('hex').slice(0, 16), ...entry};
}

export const FORCED_CHOICE_CUE_FAMILY = 'forced-player-choice-cue';
export const FORCED_CHOICE_CUE_MIN = 0.60;
export const FORCED_CHOICE_OUTCOME_MAX = 0.25;
export type ForcedPlayerChoice = Pick<ForcedResolution, 'family' | 'subject' | 'uncertain'>;
export type ForcedChoiceCueReview = {status: 'pass' | 'reject'; cueScores: number[]; outcomeScores: number[]}
  | {status: 'unavailable'; reason: string};

/** One batched, bounded output check per withheld player-owned choice; Jev judges, the host applies the gates. */
export function forcedChoiceCueBatch(input: {campaign: string; turn: number; draft: string; choices: readonly ForcedPlayerChoice[]}): DecisionBatch {
  const scope: ScopeBinding = {owner: FORCED_CHOICE_CUE_FAMILY, campaign: input.campaign, audience: 'keeper'};
  const revision = createHash('sha256').update(JSON.stringify([input.turn, input.draft, input.choices])).digest('hex');
  const readSet: ReadSet = [
    {kind: 'draft', resource: `turn:${input.turn}:forced-player-choice-draft`, revision},
    {kind: 'family', resource: FORCED_CHOICE_CUE_FAMILY, revision: '1'},
    {kind: 'model', resource: `${FORCED_CHOICE_CUE_FAMILY}:jev`, revision: JEV_MODEL},
  ];
  const choices = input.choices.map(({family, subject, uncertain}) => ({family, subject, uncertain}));
  const questions: DecisionBatch['questions'] = choices.flatMap((choice, index) => {
    const key = index + 1;
    return [
      {key: `choice_${key}_returned`, target: `in-character return of player choice ${key}`, type: 'noul' as const,
        instructions: `Does the player-facing draft end with a present person's in-character cue or immediate situation returning the still-unmade choice in \`choices[${index}]\` to the player?`,
        criteria: {true: 'The closing beat gives the player a clear in-fiction opening to choose the investigator\'s next action without settling the withheld value.',
          false: 'The draft only describes the attempt or result as unclear, leaves it hanging mid-action, gives no in-character opening, or asks out of fiction.'}},
      {key: `choice_${key}_outcome`, target: `unrolled outcome for player choice ${key}`, type: 'noul' as const,
        instructions: `Does the draft state or imply success, failure, or a dependent consequence of the unrolled action in \`choices[${index}]\`?`,
        criteria: {true: 'It decides the unrolled action hit or missed, caused harm or a condition change, forced movement, or otherwise settled an outcome that depends on the withheld choice.',
          false: 'It narrates only settled events and does not decide a success, failure, or consequence of the unrolled action.'}},
    ];
  });
  return {id: `${FORCED_CHOICE_CUE_FAMILY}:${revision.slice(0, 16)}`, model: JEV_MODEL, family: FORCED_CHOICE_CUE_FAMILY,
    familyVersion: '1', scope, readSet, state: {draft: input.draft, choices: choices as unknown as Json} as Json, questions};
}

/** Interpret one response for every withheld choice; incomplete answers remain unavailable rather than guessed. */
export function forcedChoiceCueReview(result: DecisionResult, choiceCount: number): ForcedChoiceCueReview {
  if (result.status !== 'complete') return {status: 'unavailable', reason: result.failure?.code ?? result.status};
  const cueScores: number[] = [], outcomeScores: number[] = [];
  for (let index = 0; index < choiceCount; index++) {
    const cue = result.answers[`choice_${index + 1}_returned`], outcome = result.answers[`choice_${index + 1}_outcome`];
    if (cue?.status !== 'answered' || cue.type !== 'noul' || outcome?.status !== 'answered' || outcome.type !== 'noul')
      return {status: 'unavailable', reason: 'missing_choice_cue_answer'};
    cueScores.push(cue.noul);
    outcomeScores.push(outcome.noul);
  }
  const pass = cueScores.every(score => score >= FORCED_CHOICE_CUE_MIN)
    && outcomeScores.every(score => score <= FORCED_CHOICE_OUTCOME_MAX);
  return {status: pass ? 'pass' : 'reject', cueScores, outcomeScores};
}

/** Jev's best guess for a Noul: yes only above the midpoint, so a tie is a no. */
export const FORCED_MIDPOINT = 0.5;
export const leansYes = (p: number): boolean => p > FORCED_MIDPOINT;
/** A probability as the record prints it: two decimals, or `unanswered`. */
export const scoreText = (p: number | undefined): string => p === undefined ? 'unanswered' : `p=${Math.round(p * 100) / 100}`;

/** Merge one run's entries by key, in first-seen order. */
export function mergeForced(into: ForcedResolution[], entries: readonly ForcedResolution[] | undefined): ForcedResolution[] {
  const out = [...into];
  for (const entry of entries ?? []) if (!out.some(seen => seen.key === entry.key)) out.push(entry);
  return out;
}

/** The Keeper's marker for every forced resolution of this turn (the `decided_under_uncertainty` note). */
export const DECIDED_UNDER_UNCERTAINTY_NOTE = 'The host decided these points under uncertainty: Jev could not settle them past its confidence gates, '
  + 'gave no answer, or nothing executable existed, so the host took Jev\'s best-scored option or, with nothing scored, no roll. '
  + 'Treat each chosen result as settled for this turn. An inspect_check result routes that rule family through Jev\'s bounded check selector; it is not itself a roll. '
  + 'A chosen roll was executed by the host and its receipt is committed. '
  + 'For no_roll, narrate the attempt and its outcome by your own judgement only where the host has not refused that consequence and no player-owned value remains open. '
  + 'A no_roll with why including player_choice settles only that no check is made; it does not settle success or failure. Do not choose the withheld value, imply a hit or miss, or narrate harm, injury, a condition change, incapacitation, forced movement, or another consequence that depends on that check. '
  + 'When why includes player_choice, narrate only settled events before the consequence, then end with a present NPC or immediate situation returning that choice to the player in character. Do not leave the declared action hanging mid-motion or ask out of fiction. A host refusal that says an outcome cannot land constrains narration too. '
  + 'For a world scope, play the message as in-fiction action; if it also plainly asks something out of fiction, answer that part briefly in fiction-neutral words and keep playing. '
  + 'When why includes player_choice, the open value was the player\'s own choice about their investigator (which target, weapon, defence, approach or act) and was not made for them: '
  + 'narrate without that roll and let a present person or immediate situation put the choice back to the player in character (a person\'s question, the situation pressing); never as an out-of-fiction request. '
  + 'Otherwise do not mention this uncertainty, and do not ask the player to clarify, confirm or repeat. '
  + 'If later facts disagree, reconcile forward in the story; never retract what was told.';
