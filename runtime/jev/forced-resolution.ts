/**
 * §163 (owner ruling 2026-10-01): a Jev decision that stays uncertain, unanswered or unavailable still resolves to a
 * concrete result. The host takes Jev's own best-scored option, or, with nothing executable or scored, the no-roll path
 * where the Keeper narrates by judgement; an unsettled interaction scope plays as a world turn. Every such result is a
 * forced resolution: one telemetry row (`lane: "forced-resolution"`) and one line the Keeper sees on that turn.
 */
import {createHash} from 'node:crypto';
import type {Json} from './contracts.ts';

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
  + 'Keep the fiction immediately before the unresolved consequence, or let an NPC or the situation return the choice to the player in character. A host refusal that says an outcome cannot land constrains narration too. '
  + 'For a world scope, play the message as in-fiction action; if it also plainly asks something out of fiction, answer that part briefly in fiction-neutral words and keep playing. '
  + 'When why includes player_choice, the open value was the player\'s own choice about their investigator (which target, weapon, defence, approach or act) and was not made for them: '
  + 'narrate without that roll, or let the fiction put the choice back to the player in character (a person\'s question, the situation pressing); never as an out-of-fiction request. '
  + 'Otherwise do not mention this uncertainty, and do not ask the player to clarify, confirm or repeat. '
  + 'If later facts disagree, reconcile forward in the story; never retract what was told.';
